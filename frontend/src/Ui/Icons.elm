module Ui.Icons exposing (..)

import Html exposing (Html)
import Json.Decode as D
import Json.Encode as E
import Svg
import Svg.Attributes
import Ui.Svg
import Util.EnumDecode exposing (enumDecode, enumEncode)


type Icon
    = Cogs
    | Home
    | Search
    | Person
      -- SOCIAL
    | Facebook
    | Twitter
    | Github
    | Youtube
      -- NAVIGATION
    | ArrowRight
    | ArrowLeft
      -- MISC
    | Sun
    | Moon
    | Plus
    | PlusFolder
    | ArchiveBox
    | Like


view : Icon -> Html msg
view =
    viewWithAttrs []


{-| Style icon with tailwindcss classes
-}
viewStyled : String -> Icon -> Html msg
viewStyled cls =
    viewWithAttrs [ Svg.Attributes.class cls ]


{-| Specify arbitrary attributes for the icon.

WARNING: Double check you are using Svg.Attributes.class and not
Hml.Attributes.class, as this will crash your application. This is
a known bug in Elm compiler.

-}
viewWithAttrs : List (Svg.Attribute msg) -> Icon -> Html msg
viewWithAttrs attrs icon =
    case icon of
        Cogs ->
            Ui.Svg.cogs attrs

        Home ->
            Ui.Svg.home attrs

        Search ->
            Ui.Svg.search attrs

        Person ->
            Ui.Svg.person attrs

        -- SOCIAL
        Facebook ->
            Ui.Svg.facebook attrs

        Twitter ->
            Ui.Svg.twitter attrs

        Github ->
            Ui.Svg.github attrs

        Youtube ->
            Ui.Svg.youtube attrs

        -- NAVIGATION
        ArrowRight ->
            Ui.Svg.arrowRight attrs

        ArrowLeft ->
            Ui.Svg.arrowLeft attrs

        -- MISC
        Sun ->
            Ui.Svg.sun attrs

        Moon ->
            Ui.Svg.moon attrs

        Plus ->
            Ui.Svg.plus attrs

        PlusFolder ->
            Ui.Svg.plusFolder attrs

        ArchiveBox ->
            Ui.Svg.archiveBox attrs

        Like ->
            Ui.Svg.like attrs



--- JSON Encoding/decoding


iconsMap =
    [ ( Cogs, "cogs" )
    , ( Home, "home" )
    , ( Search, "search" )
    , ( Person, "person" )
    , ( Facebook, "facebook" )
    , ( Twitter, "twitter" )
    , ( Github, "github" )
    , ( Youtube, "youtube" )
    , ( ArrowRight, "arrow-right" )
    , ( ArrowLeft, "arrow-left" )
    , ( Sun, "sun" )
    , ( Moon, "moon" )
    , ( Plus, "plus" )
    , ( PlusFolder, "plus-folder" )
    , ( ArchiveBox, "archive-box" )
    , ( Like, "like" )
    ]


decoder : D.Decoder Icon
decoder =
    enumDecode iconsMap D.string


encode : Icon -> D.Value
encode =
    enumEncode iconsMap E.string
