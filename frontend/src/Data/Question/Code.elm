module Data.Question.Code exposing
    ( Answer
    , Code
    , Env
    , Forbidden
    , Lang
    , LanguageConf
    , decode
    , encode
    , lang
    , noConf
    )

import Dict exposing (Dict)
import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E


type alias Lang =
    String


type alias Code =
    { defaultLanguage : Lang
    , options : Dict Lang LanguageConf
    }


type alias LanguageConf =
    { timeout : Float
    , placeholder : String
    , env : Env
    , forbidden : Forbidden
    }


type alias Env =
    { compilation : String
    , execution : String
    , linting : String
    }


type alias Forbidden =
    { functions : List String
    , modules : List String
    , syntax : List String
    , types : List String
    }


type alias Answer =
    { lang : Lang
    , code : String
    }


lang : LanguageConf
lang =
    { timeout = 0
    , placeholder = ""
    , env =
        { compilation = ""
        , execution = ""
        , linting = ""
        }
    , forbidden =
        { functions = []
        , modules = []
        , syntax = []
        , types = []
        }
    }


noConf : Code
noConf =
    { defaultLanguage = "text"
    , options = Dict.empty
    }


encode : Code -> E.Value
encode conf =
    let
        langConf rec =
            E.object
                [ ( "timeout", E.float rec.timeout )
                , ( "placeholder", E.string rec.placeholder )
                , ( "env"
                  , E.object
                        [ ( "compilation", E.string rec.env.compilation )
                        , ( "execution", E.string rec.env.execution )
                        , ( "linting", E.string rec.env.linting )
                        ]
                  )
                , ( "forbidden"
                  , E.object
                        [ ( "functions", E.list E.string rec.forbidden.functions )
                        , ( "modules", E.list E.string rec.forbidden.modules )
                        , ( "syntax", E.list E.string rec.forbidden.syntax )
                        , ( "types", E.list E.string rec.forbidden.types )
                        ]
                  )
                ]

        options =
            Dict.toList conf.options
                |> List.map (Tuple.mapSecond langConf)
                |> E.object
    in
    E.object
        [ ( "default-language", E.string conf.defaultLanguage )
        , ( "options", options )
        ]


decode : D.Decoder Code
decode =
    let
        langConf =
            D.succeed LanguageConf
                |> D.required "timeout" D.float
                |> D.required "placeholder" D.string
                |> D.required "env"
                    (D.map3 Env
                        (D.field "compilation" D.string)
                        (D.field "execution" D.string)
                        (D.field "linting" D.string)
                    )
                |> D.required "forbidden"
                    (D.map4 Forbidden
                        (D.field "functions" (D.list D.string))
                        (D.field "modules" (D.list D.string))
                        (D.field "syntax" (D.list D.string))
                        (D.field "types" (D.list D.string))
                    )
    in
    D.succeed Code
        |> D.optional "default-language" D.string "text"
        |> D.optional "options" (D.dict langConf) Dict.empty
