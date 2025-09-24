module Mdq.App exposing (..)

import Browser
import Html exposing (..)
import Html.Attributes exposing (..)
import Mdq.Components.MultipleChoice as MultipleChoice


main : Program () Model Msg
main =
    Browser.element
        { init = init
        , update = update
        , subscriptions = \_ -> Sub.none
        , view = view
        }


type alias Model =
    { multipleChoice : MultipleChoice.Model }


init : () -> ( Model, Cmd Msg )
init _ =
    ( { multipleChoice = MultipleChoice.init }, Cmd.none )


type Msg
    = MultipleChoiceMsg MultipleChoice.Msg
    | NoOp


update : Msg -> Model -> ( Model, Cmd Msg )
update msg_ model =
    case msg_ of
        MultipleChoiceMsg msg ->
            ( { model | multipleChoice = MultipleChoice.update msg model.multipleChoice }, Cmd.none )

        NoOp ->
            ( model, Cmd.none )


view : Model -> Html Msg
view model =
    div []
        [ h1 [] [ text "Multiple Choice Question" ]
        , Html.map MultipleChoiceMsg (MultipleChoice.view model.multipleChoice)
        ]
