module Components.SettingsPanel exposing (..)

import Effect exposing (Effect)
import Html exposing (Html, div, text)


type alias Model =
    {}


type Msg
    = NoOp


init : Model
init =
    {}


update : Msg -> Model -> ( Model, Effect Msg )
update msg model =
    case msg of
        NoOp ->
            ( model
            , Effect.none
            )


view : Model -> Html Msg
view model =
    div [] [ text (Debug.toString model) ]
