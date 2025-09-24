module Mdq.Question exposing (..)

import Json.Decode as D
import Json.Encode as E
import OpenApi.Common


type alias Question =
    { comment : String
    , epilogue : String
    , footnotes : List Footnote
    , format : TextFormat
    , grade_range : GradeRange
    , id : String
    , media : List MediaObject
    , preamble : String
    , stem : String
    , tags : List String
    , title : String
    , weight : Float
    }


init : String -> String -> Question
init id title =
    { comment = ""
    , epilogue = ""
    , footnotes = []
    , format = "md"
    , grade_range = { min = 0, max = 100 }
    , id = id
    , media = []
    , preamble = ""
    , stem = ""
    , tags = []
    , title = title
    , weight = 0
    }


type alias GradeRange =
    { max : Float, min : Float }


type alias Footnote =
    { id : String, text : String }


type alias TextFormat =
    String


type alias MediaObject =
    { caption : String, id : String, type_ : MediaType, url : String }


type alias MediaType =
    String


decodeTextFormat : D.Decoder TextFormat
decodeTextFormat =
    D.string


encodeTextFormat : TextFormat -> E.Value
encodeTextFormat =
    E.string


decodeQuestion : D.Decoder Question
decodeQuestion =
    D.succeed
        (\id title comment epilogue footnotes format grade_range media preamble stem tags weight ->
            { comment = comment
            , epilogue = epilogue
            , footnotes = footnotes
            , format = format
            , grade_range = grade_range
            , id = id
            , media = media
            , preamble = preamble
            , stem = stem
            , tags = tags
            , title = title
            , weight = weight
            }
        )
        |> OpenApi.Common.jsonDecodeAndMap (D.field "id" D.string)
        |> OpenApi.Common.jsonDecodeAndMap (D.field "title" D.string)
        |> OpenApi.Common.jsonDecodeAndMap (D.field "comment" D.string)
        |> OpenApi.Common.jsonDecodeAndMap (D.field "epilogue" D.string)
        |> OpenApi.Common.jsonDecodeAndMap (D.field "footnotes" (D.list decodeFootnote))
        |> OpenApi.Common.jsonDecodeAndMap (D.field "format" decodeTextFormat)
        |> OpenApi.Common.jsonDecodeAndMap (D.field "grade-range" decodeGradeRange)
        |> OpenApi.Common.jsonDecodeAndMap (D.field "media" (D.list decodeMediaObject))
        |> OpenApi.Common.jsonDecodeAndMap (D.field "preamble" D.string)
        |> OpenApi.Common.jsonDecodeAndMap (D.field "stem" D.string)
        |> OpenApi.Common.jsonDecodeAndMap (D.field "tags" (D.list D.string))
        |> OpenApi.Common.jsonDecodeAndMap (D.field "weight" D.float)


encodeQuestionFields : Question -> List ( String, E.Value )
encodeQuestionFields rec =
    [ ( "comment", E.string rec.comment )
    , ( "epilogue", E.string rec.epilogue )
    , ( "footnotes", E.list encodeFootnote rec.footnotes )
    , ( "format", encodeTextFormat rec.format )
    , ( "grade-range", encodeGradeRange rec.grade_range )
    , ( "id", E.string rec.id )
    , ( "media", E.list encodeMediaObject rec.media )
    , ( "preamble", E.string rec.preamble )
    , ( "stem", E.string rec.stem )
    , ( "tags", E.list E.string rec.tags )
    , ( "title", E.string rec.title )
    , ( "weight", E.float rec.weight )
    ]


decodeFootnote : D.Decoder Footnote
decodeFootnote =
    D.succeed
        (\id text -> { id = id, text = text })
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "id" D.string)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "text" D.string)


encodeFootnote : Footnote -> E.Value
encodeFootnote rec =
    E.object
        [ ( "id", E.string rec.id )
        , ( "text", E.string rec.text )
        ]


decodeGradeRange : D.Decoder GradeRange
decodeGradeRange =
    D.succeed
        (\max min -> { max = max, min = min })
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "max" D.float)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "min" D.float)


encodeGradeRange : GradeRange -> E.Value
encodeGradeRange rec =
    E.object
        [ ( "max", E.float rec.max )
        , ( "min", E.float rec.min )
        ]


decodeMediaType : D.Decoder MediaType
decodeMediaType =
    D.string


encodeMediaType : MediaType -> E.Value
encodeMediaType =
    E.string


decodeMediaObject : D.Decoder MediaObject
decodeMediaObject =
    D.succeed
        (\caption id type_ url ->
            { caption = caption, id = id, type_ = type_, url = url }
        )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "caption" D.string)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field "id" D.string)
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "type"
                decodeMediaType
            )
        |> OpenApi.Common.jsonDecodeAndMap
            (D.field
                "url"
                D.string
            )


encodeMediaObject : MediaObject -> E.Value
encodeMediaObject rec =
    E.object
        [ ( "caption", E.string rec.caption )
        , ( "id", E.string rec.id )
        , ( "type", encodeMediaType rec.type_ )
        , ( "url", E.string rec.url )
        ]
