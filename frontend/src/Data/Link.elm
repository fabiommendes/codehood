module Data.Link exposing
    ( Link
    , link, iconLink, actionLink
    , withIcon
    , map
    , PlainLink, decoder, encode, toPlain, view
    )

{-| Represents links with some styling

@docs Link


## Create

@docs link, iconLink, actionLink


## Builder pattern

@docs withIcon


## Transform

@docs map

-}

import Data.Path as Path
import Html exposing (Html, a, span, text)
import Html.Attributes exposing (class)
import Html.Events exposing (onClick)
import Json.Decode as D
import Json.Encode as E
import Route.Path as Path exposing (Path)
import Ui.Icons as Icons


type alias Link msg =
    { name : String
    , action : LinkAction msg
    , style : LinkStyle
    }


type alias PlainLink =
    Link Never


type LinkStyle
    = Plain
    | Icon Icons.Icon


type LinkAction msg
    = Href Path
    | OnClick msg


link : String -> Path -> Link msg
link name path =
    { name = name
    , action = Href path
    , style = Plain
    }


iconLink : Icons.Icon -> String -> Path -> Link msg
iconLink icon name path =
    { name = name
    , action = Href path
    , style = Icon icon
    }


actionLink : String -> msg -> Link msg
actionLink name msg =
    { name = name
    , action = OnClick msg
    , style = Plain
    }



--- BUILDER


withIcon : Icons.Icon -> Link msg -> Link msg
withIcon icon m =
    { m | style = Icon icon }


toPlain : Link msg -> Link msg
toPlain m =
    { m | style = Plain }



--- MAPPING


map : (a -> b) -> Link a -> Link b
map f { name, action, style } =
    { name = name
    , action = mapAction f action
    , style = style
    }


mapAction : (a -> b) -> LinkAction a -> LinkAction b
mapAction f action =
    case action of
        Href path ->
            Href path

        OnClick msg ->
            OnClick (f msg)



--- VIEW


view : List (Html.Attribute msg) -> Link msg -> Html msg
view attrs data =
    case data.style of
        Plain ->
            a (attrFromAction data.action :: attrs)
                [ maybeText data.name ]

        Icon icon ->
            a (attrFromAction data.action :: class "flex justify-between" :: attrs)
                [ span [] [ maybeText data.name ], Icons.viewStyled "w-5" icon ]


attrFromAction : LinkAction msg -> Html.Attribute msg
attrFromAction action =
    case action of
        Href path ->
            Path.href path

        OnClick msg ->
            onClick msg


maybeText : String -> Html msg
maybeText str =
    if str == "" then
        text "..."

    else
        text str



--- JSON


decoder : D.Decoder msg -> D.Decoder (Link msg)
decoder enc =
    D.map3 Link
        (D.field "name" D.string)
        (D.field "action" (decodeAction enc))
        (D.field "style" decodeStyle)


decodeAction : D.Decoder msg -> D.Decoder (LinkAction msg)
decodeAction enc =
    D.oneOf
        [ D.map Href (D.field "href" Path.decoder)
        , D.map OnClick (D.field "onClick" enc)
        ]


decodeStyle : D.Decoder LinkStyle
decodeStyle =
    D.oneOf
        [ D.map Icon (D.field "icon" Icons.decoder)
        , D.succeed Plain
        ]


encode : (msg -> E.Value) -> Link msg -> E.Value
encode enc { name, action, style } =
    E.object
        [ ( "name", E.string name )
        , ( "action", encodeAction enc action )
        , ( "style", encodeStyle style )
        ]


encodeAction : (msg -> E.Value) -> LinkAction msg -> E.Value
encodeAction enc action =
    case action of
        Href path ->
            E.object [ ( "href", Path.encode path ) ]

        OnClick msg ->
            E.object [ ( "onClick", enc msg ) ]


encodeStyle : LinkStyle -> E.Value
encodeStyle style =
    case style of
        Plain ->
            E.null

        Icon icon ->
            E.object [ ( "icon", Icons.encode icon ) ]
