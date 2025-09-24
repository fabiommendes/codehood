module Layouts.Main exposing (Breakpoint, Model, Msg, Props, WindowSize, layout, props)

import Api
import Api.Classrooms
import Auth exposing (User)
import Browser.Dom
import Browser.Events
import Components.Header as Header
import Data.Classroom
import Data.Navbar as Navbar
import Effect exposing (Effect, withApiError, withEff, withInnerEff, withNoEff)
import Effect.Layout as Cmds
import Html as H exposing (..)
import Html.Attributes as HA
import Html.Events as HE
import Layout exposing (Layout)
import Maybe.Extra as Maybe
import Route exposing (Route)
import Shared
import Task
import Util exposing (iff)
import Util.Lens as L
import View exposing (View)


type alias Props =
    { user : Auth.User
    , classrooms : List Data.Classroom.Classroom
    }


props : Auth.User -> Props
props user =
    { user = user
    , classrooms = []
    }


layout : Props -> Shared.Model -> Route () -> Layout () Model Msg contentMsg
layout props_ shared _ =
    Layout.new
        { init = init props_ shared
        , update = update
        , view = view
        , subscriptions = subscriptions
        }


type alias Model =
    { navbar : Navbar.Navbar Msg
    , header : Header.Model
    , showSidebar : Bool
    , logout : Bool
    , user : User
    , windowSize : WindowSize
    }


type alias WindowSize =
    { width : Float
    , height : Float
    , breakpoint : Breakpoint
    }


type Breakpoint
    = BreakpointNone
    | BreakpointSM
    | BreakpointMD
    | BreakpointLG
    | BreakpointXL


init : Props -> Shared.Model -> () -> ( Model, Effect Msg )
init props_ shared _ =
    { navbar = Navbar.navbar { logout = ToggleLogout }
    , header = Header.init
    , showSidebar = False
    , logout = False
    , user = props_.user
    , windowSize =
        { width = 0
        , height = 0
        , breakpoint = BreakpointSM
        }
    }
        |> withEff
            (Effect.batch
                [ getWindowSize
                , getEnrolled shared
                ]
            )


getWindowSize : Effect Msg
getWindowSize =
    Browser.Dom.getViewport
        |> Task.map .viewport
        |> Task.map (\{ width, height } -> ( width, height ))
        |> Effect.perform WindowResized


getEnrolled : Shared.Model -> Effect Msg
getEnrolled shared =
    shared.credentials
        |> Maybe.unpack
            (\() ->
                Api.Classrooms.getEnrolled
                    |> Effect.sendRequest ReceiveClassrooms
            )
            (\_ -> Effect.none)


type Msg
    = NoOp
    | HeaderMsg Header.Msg
    | CommandReceived Cmds.Msg
    | ToggleSidebar
    | ToggleLogout
    | LogoutRequested
    | WindowResized ( Float, Float )
    | ReceiveClassrooms (Result Api.Error (List Data.Classroom.Classroom))


update : Msg -> Model -> ( Model, Effect Msg )
update msg_ model =
    case msg_ of
        NoOp ->
            model |> withNoEff

        CommandReceived (Cmds.Invalid info) ->
            model
                |> withEff (Effect.error "Invalid command" info)

        CommandReceived (Cmds.AddNavbarSections sections) ->
            { model | navbar = Navbar.withSections sections model.navbar }
                |> withNoEff

        CommandReceived (Cmds.PageLoaded _) ->
            { model | navbar = Navbar.withSections [] model.navbar }
                |> withNoEff

        WindowResized ( width, height ) ->
            model
                |> L.windowSize.set
                    { width = width
                    , height = height
                    , breakpoint = widthToBreakpoint width
                    }
                |> withNoEff

        ToggleSidebar ->
            model
                |> L.showSidebar.set (not model.showSidebar)
                |> withNoEff

        ToggleLogout ->
            model
                |> L.update L.logout not
                |> withNoEff

        LogoutRequested ->
            model
                |> withEff Effect.logout

        HeaderMsg Header.LogoClicked ->
            model
                |> L.update L.showSidebar not
                |> withNoEff

        HeaderMsg msg ->
            model
                |> withInnerEff L.header
                    { update = Header.update msg
                    , msg = HeaderMsg
                    }

        ReceiveClassrooms (Ok data) ->
            model
                |> L.update L.navbar (Navbar.withEnrolled data)
                |> withNoEff

        ReceiveClassrooms (Err err) ->
            model
                |> withApiError err


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.batch
        [ Browser.Events.onResize (\x y -> WindowResized ( toFloat x, toFloat y ))
        , Cmds.messages CommandReceived
        ]


view : { toContentMsg : Msg -> contentMsg, content : View contentMsg, model : Model } -> View contentMsg
view { toContentMsg, model, content } =
    let
        isDrawer =
            model.windowSize.breakpoint == BreakpointSM || model.windowSize.breakpoint == BreakpointNone

        header =
            H.map (HeaderMsg >> toContentMsg) (Header.view model.header)

        main =
            H.main_
                [ HA.class "MainLayout-main bg-base-100/70 overflow-y-auto w-full h-min-full flex flex-col"
                , HA.class (iff isDrawer "drawer-content" "")
                , HA.class "md:rounded-tl-2xl lg:rounded-t-6xl md:shadow-md"
                ]
                content.body

        navbar =
            H.map toContentMsg (Navbar.view model.navbar)

        logout =
            if model.logout then
                H.map toContentMsg <| logoutDialog model

            else
                text ""
    in
    { title = content.title
    , body =
        [ div
            [ HA.class "MainLayout"
            , HA.class (iff isDrawer "drawer" "MainLayout--grid")
            , HA.style "box-shadow" "inset rgb(0 0 0 / 0.20) 0 0 50vw -5vw"
            ]
            (pageLayout model
                { header = header
                , main = main
                , navbar = navbar
                , isDrawer = isDrawer
                }
            )
        , logout
        ]
    }


pageLayout :
    Model
    ->
        { header : Html msg
        , main : Html msg
        , navbar : Html msg
        , isDrawer : Bool
        }
    -> List (Html msg)
pageLayout model parts =
    if parts.isDrawer then
        [ input [ HA.type_ "checkbox", HA.id "main-drawer", HA.class "drawer-toggle", HA.checked model.showSidebar ] []
        , div [ HA.class "drawer-content" ]
            [ parts.header
            , parts.main
            ]
        , div [ HA.class "drawer-side" ]
            [ label [ HA.for "main-drawer", HA.class "drawer-overlay" ] []
            , parts.navbar
            ]
        ]

    else
        [ parts.navbar
        , parts.header
        , parts.main
        ]


logoutDialog : Model -> Html Msg
logoutDialog _ =
    H.node "dialog"
        [ HA.id "logout-modal"
        , HA.class "modal modal-open"
        ]
        [ div [ HA.class "modal-box py-8" ]
            [ h3 [ HA.class "text-lg font-bold" ]
                [ text "Do you really want to sign out?" ]
            , div [ HA.class "modal-action" ]
                [ button
                    [ HA.class "btn btn-ghost px-4", HE.onClick ToggleLogout ]
                    [ text "No" ]
                , button
                    [ HA.class "btn btn-primary", HE.onClick LogoutRequested ]
                    [ text "Yes" ]
                ]
            ]
        ]


widthToBreakpoint : Float -> Breakpoint
widthToBreakpoint width =
    if width < 640 then
        BreakpointNone

    else if width < 768 then
        BreakpointSM

    else if width < 1025 then
        BreakpointMD

    else if width < 1280 then
        BreakpointLG

    else
        BreakpointXL
