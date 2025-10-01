module Pages.System.Styles exposing (Model, Msg, page)

import Auth
import Data.Link as Link
import Effect exposing (Effect)
import Html as H exposing (..)
import Html.Attributes exposing (..)
import Layouts
import Layouts.Main as Layout
import Page exposing (Page)
import Route exposing (Route)
import Route.Path as Path
import Shared
import Ui
import Ui.Container as Ui
import Ui.Icons as Icons
import View exposing (View)


lorem : String
lorem =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua."


loremLong : String
loremLong =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum."


page : Auth.User -> Shared.Model -> Route () -> Page Model Msg
page user _ _ =
    Page.new
        { init = init
        , update = update
        , subscriptions = subscriptions
        , view = view
        }
        |> Page.withLayout (\_ -> Layouts.Main (Layout.props user))


type alias Model =
    {}


init : () -> ( Model, Effect Msg )
init () =
    ( {}
    , Effect.none
    )



-- UPDATE


type Msg
    = NoOp


update : Msg -> Model -> ( Model, Effect Msg )
update msg model =
    case msg of
        NoOp ->
            ( model
            , Effect.none
            )



-- SUBSCRIPTIONS


subscriptions : Model -> Sub Msg
subscriptions _ =
    Sub.none



-- VIEW


view : Model -> View Msg
view _ =
    let
        breadcrumbs =
            Ui.breadcrumbs [ Link.link "System" Path.System_Styles ] "Styles"

        paragraph =
            Ui.flat [ class "prose" ]
                [ h2 [] [ text "Prose styles and typography" ]
                , p []
                    [ text "A paragraph with semantic "
                    , strong [] [ text "bold" ]
                    , text ", "
                    , em [] [ text "italic" ]
                    , text ", "
                    , strong [] [ em [] [ text "bold-italic" ] ]
                    , text " and "
                    , code [] [ text "code" ]
                    , text " text. "
                    , a [ href "#" ] [ text "Links" ]
                    , text " show like this and can have "
                    , a [ href "#", class "no-underline" ] [ text "no-underline" ]
                    , text "."
                    ]
                ]

        sections =
            [ Ui.base [ class "prose" ]
                [ h2 [] [ text "Primary container color" ]
                , p [] [ text loremLong ]
                ]
            , Ui.primary [ class "prose" ]
                [ h2 [] [ text "Primary container color" ]
                , p [] [ text lorem ]
                ]
            , Ui.secondary [ class "prose" ]
                [ h2 [] [ text "Secondary container color" ]
                , p [] [ text lorem ]
                ]
            , Ui.accent [ class "prose" ]
                [ h2 [] [ text "Accent container color" ]
                , p [] [ text lorem ]
                ]
            , Ui.info [ class "prose" ]
                [ h2 [] [ text "Info container color" ]
                , p [] [ text lorem ]
                ]
            , Ui.warning [ class "prose" ]
                [ h2 [] [ text "Warning container color" ]
                , p [] [ text lorem ]
                ]
            , Ui.error [ class "prose" ]
                [ h2 [] [ text "Error container color" ]
                , p [] [ text lorem ]
                ]
            ]

        typography =
            Ui.flat [ class "prose" ]
                [ p [] [ text lorem ]
                , h1 [] [ text "The Big Heading, for the Page Title" ]
                , h2 [] [ text "Second Heading, for the Page Subtitle" ]
                , h3 [] [ text "Third Heading, usually for the Section Title" ]
                , h4 [] [ text "Fourth Heading, usually for the Subsection Title" ]
                , h5 [] [ text "Fifth Heading, for the Subsubsection Title" ]
                , h6 [] [ text "Sixth Heading, for the Paragraph Title" ]
                , h3 [] [ text "Bold and Italic" ]
                , h3 [] [ text "Blockquotes and code" ]
                , blockquote [] [ text "A blockquote with no styling" ]
                , blockquote [ class "alert" ] [ text "A blockquote with no alert class." ]
                , pre []
                    [ code []
                        [ text "# A <pre><code> block\nprint(\"Hello World!\")" ]
                    ]
                , h2 [] [ text "Lists <ul> and <ol>" ]
                , ul []
                    [ li []
                        [ text "First item" ]
                    , li []
                        [ text "Second item"
                        , ul []
                            [ li [] [ text "Subitem one" ]
                            , li [] [ text "Subitem two" ]
                            ]
                        ]
                    ]
                , ol
                    []
                    [ li [] [ text "Step one" ]
                    , li []
                        [ text "Step two"
                        , ol []
                            [ li [] [ text "Substep one" ]
                            , li [] [ text "Substep two" ]
                            ]
                        ]
                    ]
                ]

        colors =
            Ui.flat
                [ class "prose" ]
                [ h2 [] [ text "Colors" ]
                , p []
                    [ spanClass "text-primary"
                    , text ", "
                    , spanClass "text-secondary"
                    , text ", "
                    , spanClass "text-accent"
                    , text ", "
                    , spanClass "text-info"
                    , text ", "
                    , spanClass "text-warning"
                    , text ", "
                    , spanClass "text-error"
                    , text "."
                    ]

                -- Force themes: bg-primary, bg
                , div []
                    [ showColor "primary" -- bg-primary text-primary-content
                    , showColor "secondary" -- bg-secondary text-secondary-content
                    , showColor "accent" -- bg-accent text-accent-content
                    , showColor "info" -- bg-info text-info-content
                    , showColor "success" -- bg-success text-success-content
                    , showColor "warning" -- bg-warning text-warning-content
                    , showColor "error" -- bg-error text-error-content
                    ]
                ]

        footer =
            H.footer
                [ class "footer sm:footer-horizontal bg-primary text-primary-content p-10 mt-8"
                , style "background" "url(/static/img/bg/congruent_outline.png)"
                ]
                [ nav []
                    [ h6 [ class "footer-title" ]
                        [ text "Services" ]
                    , a [ class "link link-hover" ]
                        [ text "Branding" ]
                    , a [ class "link link-hover" ]
                        [ text "Advertisement" ]
                    ]
                , nav []
                    [ h6 [ class "footer-title" ]
                        [ text "Company" ]
                    , a [ class "link link-hover" ]
                        [ text "About us" ]
                    , a [ class "link link-hover" ]
                        [ text "Contact" ]
                    ]
                , nav []
                    [ h6 [ class "footer-title" ]
                        [ text "Social" ]
                    , div [ class "grid grid-flow-col gap-4" ]
                        [ a [] [ Icons.view Icons.Twitter ]
                        , a [] [ Icons.view Icons.Youtube ]
                        , a [] [ Icons.view Icons.Github ]
                        ]
                    ]
                ]
    in
    { title = "List of CodeHood styles"
    , body =
        List.concat
            [ [ breadcrumbs ]
            , [ paragraph ]
            , sections
            , [ typography ]
            , [ colors ]
            , [ footer ]
            ]
    }


spanClass : String -> Html msg
spanClass cls =
    span [ class cls ] [ text cls ]


showColor : String -> Html msg
showColor color =
    let
        cls =
            "bg-" ++ color ++ " text-" ++ color ++ "-content"
    in
    div [ class "flex align-center" ] [ div [ class cls, class "font-bold text-center w-6 h-6 mx-4 rounded-sm" ] [ text "?" ], span [] [ text cls ] ]
