module Data.Question.TrueFalse exposing
    ( Answer
    , TrueFalse
    , decoder
    , encode
    , encodeAnswer
    , init
    , view
    )

import Data.Question.Base exposing (Id, ToMsg)
import Data.Question.ChoiceBase as Base exposing (ChoiceBase)
import Data.Question.Type as Type exposing (QuestionType(..))
import Dict exposing (Dict)
import Html as H exposing (Html)
import Html.Attributes as HA
import Html.Events as HE
import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E


type alias TrueFalse =
    ChoiceBase Answer


type alias Answer =
    Dict String Bool


init : { id : String, title : String, stem : String } -> TrueFalse
init =
    Base.initBase


encode : TrueFalse -> E.Value
encode =
    Base.encodeBase Type.TrueFalse encodeAnswer


encodeAnswer : Dict String Bool -> E.Value
encodeAnswer =
    E.dict identity E.bool


decoder : D.Decoder TrueFalse
decoder =
    Base.baseDecoder (D.dict D.bool)


view : ToMsg Answer msg -> TrueFalse -> Html msg
view options question =
    let
        answer =
            question.answer
                |> Maybe.withDefault Dict.empty

        isSelected id =
            Dict.member id answer

        getProps id =
            case Dict.get id answer of
                Just True ->
                    { class = "bg-success/50 text-success-content"
                    , type_ = "checkbox"
                    , next = Just False
                    }

                Just False ->
                    { class = "bg-error/50 text-error-content"
                    , type_ = "checkbox"
                    , next = Nothing
                    }

                Nothing ->
                    { class = "bg-base-300/50 text-base-content"
                    , type_ = "radio"
                    , next = Just True
                    }

        respondToClick nextState id =
            options.onSetAnswer
                (case nextState of
                    Just value ->
                        Dict.insert id value answer

                    Nothing ->
                        Dict.remove id answer
                )

        renderInput id =
            let
                props =
                    getProps id
            in
            H.span [ HA.class <| "font-bold p-1 mr-2 rounded-full " ++ props.class ]
                [ H.span [ HA.class "px-2" ] [ H.text "F" ]
                , H.input
                    [ HA.type_ props.type_
                    , HA.class "toggle toggle-accent"
                    , HA.checked (Dict.get id answer == Just True)
                    , HE.onClick (respondToClick props.next id)
                    ]
                    []
                , H.span [ HA.class "px-2" ] [ H.text "V" ]
                ]

        cfg : Base.RenderCfg msg
        cfg =
            { class = "true-false"
            , input = renderInput
            , isSelected = isSelected
            }
    in
    Base.view cfg question
