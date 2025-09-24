module Data.Question.ChoiceBase exposing
    ( Choice
    , ChoiceBase
    , RenderCfg
    , baseDecoder
    , choiceDecoder
    , encodeBase
    , encodeChoice
    , extendBase
    , initBase
    , view
    )

import Data.Question.Base as Base exposing (Id, QuestionBase)
import Data.Question.Type as Type exposing (QuestionType)
import Html as H exposing (Html)
import Html.Attributes as HA
import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E
import Util exposing (iff)


type alias Choice =
    { id : Id
    , text : String
    , feedback : String
    }


encodeChoice : Choice -> E.Value
encodeChoice choice =
    E.object
        [ ( "id", E.string choice.id )
        , ( "text", E.string choice.text )
        , ( "feedback", E.string choice.feedback )
        ]


choiceDecoder : D.Decoder Choice
choiceDecoder =
    D.succeed Choice
        |> D.required "id" D.string
        |> D.required "text" D.string
        |> D.optional "feedback" D.string ""


type alias ChoiceBase answer =
    QuestionBase answer Extra


type alias Extra =
    { choices : List Choice }


initBase : { id : String, title : String, stem : String } -> ChoiceBase answer
initBase { id, title, stem } =
    Base.init { id = id, title = title, stem = stem }
        |> extendBase { choices = [] }


extendBase : Extra -> QuestionBase answer any -> ChoiceBase answer
extendBase extra base =
    { choices = extra.choices
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


encodeBase : QuestionType -> (answer -> E.Value) -> ChoiceBase answer -> E.Value
encodeBase type_ encodeAnswer question =
    E.object
        (( "choices", E.list encodeChoice question.choices )
            :: ( "type", Type.encode type_ )
            :: Base.encodeFields encodeAnswer question
        )


baseDecoder : D.Decoder answer -> D.Decoder (ChoiceBase answer)
baseDecoder decodeAnswer =
    -- let
    -- decodeAnswer =
    --     D.list D.string |> D.map Set.fromList
    -- in
    Base.decoder decodeAnswer
        |> D.andThen
            (\base ->
                D.succeed Extra
                    |> D.required "choices" (D.list choiceDecoder)
                    |> D.map (\extra -> extendBase extra base)
            )


type alias RenderCfg msg =
    { class : String
    , input : Id -> Html msg
    , isSelected : Id -> Bool
    }


view : RenderCfg msg -> ChoiceBase answer -> Html msg
view { input, class, isSelected } { choices } =
    H.ul [ HA.class class ]
        (choices
            |> List.map
                (\{ id, text } ->
                    H.li
                        [ HA.class "mx-2 w-full p-4 transition-background duration-500"
                        , HA.class (iff (isSelected id) "bg-base-200 text-base-content" "")
                        ]
                        [ H.label [ HA.class "flex w-full items-start" ]
                            [ input id
                            , H.div [ HA.class "flex-1" ] [ H.text text ]
                            ]
                        ]
                )
        )
