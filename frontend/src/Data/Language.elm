module Data.Language exposing (Language(..), decoder, encode, init)

{-| Represent the supported languages
-}

import Json.Decode as D
import Json.Encode as E
import Util.EnumDecode exposing (enumDecode, enumEncode)


type Language
    = EN
    | PT_BR


init : Language
init =
    EN


languageType : List ( Language, String )
languageType =
    [ ( EN, "en" )
    , ( PT_BR, "pt-br" )
    ]


encode : Language -> E.Value
encode =
    enumEncode languageType E.string


decoder : D.Decoder Language
decoder =
    enumDecode languageType D.string
