module Layouts.Main exposing (Model, Msg, Props, WindowSize, layout, props)

import Api
import Api.Classrooms
import Auth exposing (User)
import Browser.Dom
import Browser.Events
import Data.Classroom
import Data.Navbar as Navbar
import Effect exposing (Effect, withApiError, withEff, withNoEff)
import Effect.Layout as Cmds
import Html as H exposing (..)
import Html.Attributes as HA exposing (..)
import Html.Events as HE exposing (..)
import Layout exposing (Layout)
import Maybe.Extra as Maybe
import Route exposing (Route)
import Route.Path as Path
import Shared
import Task
import Ui.Icons as Icons
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
    , logoutDialog : Bool
    , user : User
    , windowSize : WindowSize
    }


type WindowSize
    = WindowSM
    | WindowMD
    | WindowLG
    | WindowXL


init : Props -> Shared.Model -> () -> ( Model, Effect Msg )
init props_ shared _ =
    { navbar = Navbar.navbar { logout = ToggleLogout }
    , logoutDialog = False
    , user = props_.user
    , windowSize = WindowSM
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
    = CommandReceived Cmds.Msg
    | ToggleLogout
    | LogoutRequested
    | WindowResized ( Float, Float )
    | ReceiveClassrooms (Result Api.Error (List Data.Classroom.Classroom))


update : Msg -> Model -> ( Model, Effect Msg )
update msg_ model =
    case msg_ of
        CommandReceived (Cmds.Invalid info) ->
            model
                |> withEff (Effect.error "Invalid command" info)

        CommandReceived (Cmds.AddNavbarSections sections) ->
            { model | navbar = Navbar.withSections sections model.navbar }
                |> withNoEff

        CommandReceived (Cmds.PageLoaded _) ->
            { model | navbar = Navbar.withSections [] model.navbar }
                |> withNoEff

        WindowResized ( width, _ ) ->
            model
                |> L.windowSize.set (widthToWindow width)
                |> withNoEff

        ToggleLogout ->
            model
                |> L.update L.logoutDialog not
                |> withNoEff

        LogoutRequested ->
            model
                |> withEff Effect.logout

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
        -- isDrawer =
        --     model.windowSize == WindowSM
        header =
            H.header
                [ class "flex h-12 w-full" ]
                [ label [ for "main-drawer", class "btn btn-sm btn-ghost size-12 p-0 drawer-button ml-2 lg:hidden" ] [ Icons.view Icons.Menu ]
                , a [ HA.class "flex-1 h-12 h-full text-center", Path.href Path.Home_ ]
                    [ img [ src "/static/logo.svg", class "h-full inline", alt "CodeHood" ] []
                    ]
                , button [ class "btn btn-sm btn-ghost size-12 rounded-full mr-2 p-0" ] [ Icons.view Icons.Person ]
                ]

        main =
            H.main_
                [ HA.class "overflow-y-auto w-full h-min-full flex flex-col"
                , HA.class "drawer-content"
                ]
                content.body

        navbar =
            H.map toContentMsg (Navbar.view model.navbar)

        logout =
            if model.logoutDialog then
                H.map toContentMsg <| logoutDialog model

            else
                text ""
    in
    { title = content.title
    , body =
        [ div
            [ HA.class "drawer lg:drawer-open min-h-screen flex flex-col"
            , HA.style "box-shadow" "inset rgb(22 31 40 / 0.20) 0 -5vh 35vw -5vw"
            ]
            (pageLayout model
                { header = header
                , main = main
                , navbar = navbar
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
        }
    -> List (Html msg)
pageLayout _ parts =
    [ input [ HA.type_ "checkbox", HA.id "main-drawer", HA.class "drawer-toggle" ] []
    , div [ HA.class "drawer-content flex flex-col items-center justify-center" ]
        [ parts.header
        , parts.main
        ]
    , div [ HA.class "drawer-side" ]
        [ label [ HA.for "main-drawer", HA.class "drawer-overlay" ] []
        , parts.navbar
        ]
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


widthToWindow : Float -> WindowSize
widthToWindow width =
    if width < 640 then
        WindowSM

    else if width < 768 then
        WindowMD

    else if width < 1025 then
        WindowLG

    else
        WindowXL
