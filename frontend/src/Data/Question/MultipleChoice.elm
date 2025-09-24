module Data.Question.MultipleChoice exposing
    ( Answer
    , MultipleChoice
    , decoder
    , encode
    , encodeAnswer
    , init
    , view
    )

import Data.Question.Base exposing (Id, ToMsg)
import Data.Question.ChoiceBase as Base exposing (ChoiceBase)
import Data.Question.Type as Type exposing (QuestionType(..))
import Html as H exposing (Html)
import Html.Attributes as HA
import Html.Events as HE
import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E
import Set exposing (Set)
import Util exposing (iff)


type alias MultipleChoice =
    ChoiceBase Answer


type alias Answer =
    Set Id


init : { id : String, title : String, stem : String } -> MultipleChoice
init =
    Base.initBase


encode : MultipleChoice -> E.Value
encode =
    Base.encodeBase Type.MultipleChoice encodeAnswer


encodeAnswer : Set String -> E.Value
encodeAnswer =
    E.set E.string


decoder : D.Decoder MultipleChoice
decoder =
    Base.baseDecoder (D.list D.string |> D.map Set.fromList)


view : ToMsg Answer msg -> MultipleChoice -> Html msg
view options question =
    let
        answer =
            question.answer
                |> Maybe.withDefault Set.empty

        isSelected id =
            Set.member id answer

        updateSelected id check =
            if check then
                options.onSetAnswer (Set.singleton id)

            else
                options.onSetAnswer Set.empty

        renderInput id =
            let
                isChecked =
                    isSelected id
            in
            H.input
                [ HA.class (iff isChecked "checkbox checkbox-primary rounded-full" "radio")
                , HA.class "mx-2"
                , HA.type_ "radio"
                , HA.checked isChecked
                , HE.onCheck (updateSelected id)
                ]
                []

        cfg : Base.RenderCfg msg
        cfg =
            { class = ""
            , isSelected = isSelected
            , input = renderInput
            }
    in
    Base.view cfg question
