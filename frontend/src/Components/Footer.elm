module Components.Footer exposing (..)

import Html exposing (..)
import Html.Attributes exposing (class, style)
import Ui.Icons as Icons


type alias Model =
    {}


type Msg
    = NoOp


init : Model
init =
    {}


update : Msg -> Model -> Model
update msg model =
    case msg of
        NoOp ->
            model


view : Model -> Html msg
view _ =
    footer
        [ class "MainLayout-footer sm:footer-horizontal bg-primary text-primary-content p-10"
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
