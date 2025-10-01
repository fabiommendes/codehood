module Elements.Empty exposing (Model, Msg(..), init, update, view)

{-| An empty template element
-}

import Effect exposing (..)
import Html exposing (..)
import Html.Attributes exposing (..)
import Ui.Cards as Cards
import Ui.Icons as Icons
import Util exposing (..)


type alias Model =
    {}


type Msg
    = NoOp


init : ( Model, Effect Msg )
init =
    ( {}, Effect.none )


update : Msg -> Model -> ( Model, Effect Msg )
update msg model =
    case msg of
        NoOp ->
            model |> withNoEff


view : Model -> Html Msg
view _ =
    div [ class "p-4 rounded-full" ]
        [ text "Exemple component"
        ]
