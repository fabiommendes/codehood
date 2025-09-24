module Components.Header exposing (Model, Msg(..), init, lens, update, view)

{-| This module implements the Toolbar on top of the UI
-}

import Effect exposing (Effect, withNoEff)
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (..)
import Ui.Icons as Icons
import Ui.Svg
import Util.Lens exposing (Lens)


type alias Model =
    {}


type Msg
    = LogoClicked
    | NoOp


init : Model
init =
    {}


lens : Lens { a | header : Model } Model
lens =
    Lens .header (\v m -> { m | header = v })


update : Msg -> Model -> ( Model, Effect Msg )
update msg model =
    case msg of
        _ ->
            model
                |> withNoEff


view : Model -> Html Msg
view _ =
    header
        [ class "MainLayout-header flex items-center w-full h-(--header-height) md:px-4" ]
        [ label [ for "main-drawer", class "btn btn-ghost drawer-button" ]
            [ Ui.Svg.logo [] "w-[9rem] top-2" "logo-main" "logo-outro" ]

        -- , div
        --     [ class "ml-auto absolute hidden md:block!"
        --     , style "right" "var(--sidebar-width)"
        --     ]
        --     [ label [ class "input input-sm rounded-full bg-white/50 input w-96 flex-1" ]
        --         [ Icons.viewStyled "h-[1em] opacity-75" Icons.Search
        --         , input [ type_ "search", class "grow focus:bg-white", placeholder "Search" ]
        --             []
        --         , kbd [ class "kbd kbd-sm" ]
        --             [ text "⌘" ]
        --         , kbd [ class "kbd kbd-sm" ]
        --             [ text "K" ]
        --         ]
        --     ]
        , button [ class "btn btn-sm bg-black/10 btn-ghost size-11 shadow-sm rounded-full p-2 ml-auto" ] [ Icons.view Icons.Cogs ]
        , button [ class "btn btn-sm btn-primary size-16 shadow-sm rounded-full ml-4" ] [ Icons.view Icons.Person ]
        ]
