module Elements.Empty exposing (Model, Msg(..), init, update, view)

{-| An empty template element
-}

import Html exposing (..)
import Html.Attributes exposing (..)
import Ui.Cards as Cards
import Ui.Icons as Icons
import Util exposing (..)


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


view : Model -> Html Msg
view _ =
    div [ class "p-4 rounded-full" ]
        [ text "Exemple element"
        ]
