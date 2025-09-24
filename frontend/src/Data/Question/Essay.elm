module Data.Question.Essay exposing
    ( Answer
    , Essay
    , Input(..)
    , decoder
    , encode
    , encodeAnswer
    , init
    , view
    )

import Data.Question.Base as Base exposing (QuestionBase, ToMsg)
import Data.Question.Type as Type exposing (QuestionType(..))
import Html as H exposing (Html)
import Html.Attributes as HA
import Html.Events as HE
import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E


type alias Essay =
    QuestionBase Answer Extra


type alias Extra =
    { input : Input }


type Input
    = Text
    | RichText
    | Code String


type alias Answer =
    String


init : { id : String, title : String, stem : String } -> Essay
init { id, title, stem } =
    Base.init { id = id, title = title, stem = stem }
        |> extend { input = Text }


extend : Extra -> QuestionBase Answer any -> Essay
extend extra base =
    { input = extra.input
    , id = base.id
    , title = base.title
    , stem = base.stem
    , format = base.format
    , weight = base.weight
    , preamble = base.preamble
    , epilogue = base.epilogue
    , footnotes = base.footnotes
    , media = base.media
    , tags = base.tags
    , comment = base.comment
    , isGraded = base.isGraded
    , answer = base.answer
    }


encode : Essay -> E.Value
encode question =
    let
        encodeInput type_ =
            case type_ of
                Text ->
                    E.string "text"

                RichText ->
                    E.string "rich-text"

                Code "" ->
                    E.string "code"

                Code lang ->
                    E.string lang
    in
    E.object
        (( "input", encodeInput question.input )
            :: ( "type", Type.encode Type.Essay )
            :: Base.encodeFields encodeAnswer question
        )


encodeAnswer : Answer -> E.Value
encodeAnswer =
    E.string


decoder : D.Decoder Essay
decoder =
    let
        decodeInput =
            D.string
                |> D.andThen
                    (\input ->
                        case input of
                            "text" ->
                                D.succeed Text

                            "richtext" ->
                                D.succeed RichText

                            "code" ->
                                D.succeed (Code "")

                            lang ->
                                D.succeed (Code lang)
                    )

        decodeAnswer =
            D.string
    in
    Base.decoder decodeAnswer
        |> D.andThen
            (\base ->
                D.succeed Extra
                    |> D.required "input" decodeInput
                    |> D.map (\extra -> extend extra base)
            )


view : ToMsg Answer msg -> Essay -> Html msg
view toMsg essay =
    let
        inputMsg data =
            toMsg.onSetAnswer data

        text =
            essay.answer |> Maybe.withDefault ""

        input =
            case essay.input of
                Code _ ->
                    H.textarea
                        [ HA.class "textarea textarea-primary w-full h-48"
                        , HA.placeholder "Type your answer here..."
                        , HA.value text
                        ]
                        []

                _ ->
                    H.textarea
                        [ HA.class "textarea textarea-primary w-full h-52"
                        , HA.placeholder "Type your answer here..."
                        , HA.value text
                        , HE.onInput inputMsg
                        ]
                        []
    in
    H.div [ HA.class "prose" ] [ input ]
