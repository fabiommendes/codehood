module Data.Menu exposing (Menu, StaticMenu, decoder, encode, encodeStatic, map, nonStatic, staticDecoder, view)

import Data.Link as Link exposing (Link)
import Html exposing (..)
import Html.Attributes exposing (..)
import Json.Decode as D
import Json.Encode as E


type alias Menu msg =
    { id : String
    , title : String
    , links : List (Link msg)
    }


type alias StaticMenu =
    Menu Never


map : (msg -> msg2) -> Menu msg -> Menu msg2
map f menu =
    { id = menu.id
    , title = menu.title
    , links = List.map (Link.map f) menu.links
    }


nonStatic : StaticMenu -> Menu msg
nonStatic =
    map bottom


bottom : Never -> b
bottom x =
    bottom x


view : Menu msg -> Html msg
view menu =
    section
        [ class "menu w-full p-0 heading text-lg uppercase"
        ]
        [ if menu.title == "" then
            text ""

          else
            h2 [ class "bg-base-300 p-2" ] [ text menu.title ]
        , if List.isEmpty menu.links then
            p [ class "p-4" ] [ text "Empty :-(" ]

          else
            ul [ class "mb-4 font-bold" ]
                (menu.links |> List.map (Link.view [ class "px-4 py-3" ]))
        ]



--- JSON


encode : (msg -> E.Value) -> Menu msg -> E.Value
encode enc menu =
    E.object
        [ ( "id", E.string menu.id )
        , ( "title", E.string menu.title )
        , ( "links", E.list (Link.encode enc) menu.links )
        ]


encodeStatic : StaticMenu -> E.Value
encodeStatic =
    encode (\_ -> E.null)


decoder : D.Decoder msg -> D.Decoder (Menu msg)
decoder enc =
    D.map3 Menu
        (D.field "id" D.string)
        (D.field "title" D.string)
        (D.field "links" (D.list (Link.decoder enc)))


staticDecoder : D.Decoder StaticMenu
staticDecoder =
    decoder (D.fail "never cannot be decoded")
