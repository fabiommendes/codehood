moduleData._Question._Questionon exposing (..)

{-| The generic question type
-}

import Data.Answer exposing (Answer(..))
import Data._Question.Base as Base exposing (QuestionType(..))
import Data._Question.Choice as Choice exposing (Choice)
import Data._Question.Code as Code exposing (Code)
import Data._Question.Essay as Essay exposing (Prompt)
import Data._Question.FillIn as FillIn
import Data._Question.Pairings as Pairings exposing (Pairings)
import Dict
import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E
import Set


type alias Answer =
    Data.Answer.Answer


type alias Id =
    String


type alias Text =
    String


{-| The generic question type
-}
type alias Question =
    Base.Question QuestionPrompt


type QuestionPrompt
    = AssociativePrompt Pairings
    | ChoicePrompt (List Choice)
    | CodePrompt Code
    | EssayPrompt Prompt
    | FillInPrompt FillIn.Prompt


initState : Question -> Answer
initState question =
    case ( question.type_, question.input ) of
        ( Essay, _ ) ->
            EssayAnswer { text = "" }

        ( MultipleChoice, _ ) ->
            MultipleChoiceAnswer { answer = Set.empty }

        ( MultipleSelect, _ ) ->
            MultipleSelectAnswer { answer = Set.empty }

        ( TrueFalse, _ ) ->
            TrueFalseAnswer { answer = Dict.empty }

        ( FillIn, _ ) ->
            FillInAnswer { answer = Dict.empty }

        ( Associative, _ ) ->
            AssociativeAnswer { pairings = Dict.empty }

        ( CodeIO, CodePrompt { defaultLanguage } ) ->
            CodeIOAnswer { lang = defaultLanguage, code = "" }

        ( CodeIO, _ ) ->
            CodeIOAnswer { lang = "", code = "" }

        ( UnitTest, CodePrompt { defaultLanguage } ) ->
            UnitTestAnswer { lang = defaultLanguage, code = "" }

        ( UnitTest, _ ) ->
            UnitTestAnswer { lang = "", code = "" }



--- JSON ENCODERS/DECODERS


encode : Question -> E.Value
encode question =
    Base.encode encodeInput question


decoder : D.Decoder Question
decoder =
    D.map2 (\f input -> f input)
        Base.decode
        decodeInput


encodeInput : QuestionPrompt -> List ( String, E.Value )
encodeInput input =
    case input of
        AssociativePrompt data ->
            Pairings.encode data

        ChoicePrompt data ->
            [ ( "choices", E.list Choice.encode data ) ]

        CodePrompt data ->
            [ ( "conf", Code.encode data ) ]

        EssayPrompt data ->
            [ ( "essay", Essay.encode data ) ]

        FillInPrompt data ->
            [ ( "body", E.list FillIn.encode data ) ]


decodeInput : D.Decoder QuestionPrompt
decodeInput =
    D.field "type" Base.decodeType
        |> D.andThen
            (\kind ->
                case kind of
                    Base.Associative ->
                        D.field "pairings" Pairings.decode |> D.map AssociativePrompt

                    Base.MultipleChoice ->
                        D.field "choices" (D.list Choice.decode) |> D.map ChoicePrompt

                    Base.MultipleSelect ->
                        D.field "choices" (D.list Choice.decode) |> D.map ChoicePrompt

                    Base.TrueFalse ->
                        D.field "choices" (D.list Choice.decode) |> D.map ChoicePrompt

                    Base.FillIn ->
                        D.field "body" (D.list FillIn.decode) |> D.map FillInPrompt

                    Base.CodeIO ->
                        D.field "conf" Code.decode |> D.map CodePrompt

                    Base.UnitTest ->
                        D.field "conf" Code.decode |> D.map CodePrompt

                    Base.Essay ->
                        D.field "essay" Essay.decode |> D.map EssayPrompt
            )



--- CREATE NEW QUESTIONS


{-| Create a new essay question
-}
essay : { id : String, title : String, stem : String } -> Prompt -> Question
essay data type_ =
    Base.initUnsafe Base.Essay data (EssayPrompt type_)


{-| Create a new multiple choice question
-}
multipleChoice : { id : String, title : String, stem : String } -> List ( Id, Text ) -> Question
multipleChoice data choices =
    let
        choices_ =
            choices |> List.map (\( id, text ) -> { id = id, text = text, feedback = "" })
    in
    Base.initUnsafe Base.MultipleChoice data (ChoicePrompt choices_)


{-| Create a new multiple select question
-}
multipleSelect : { id : String, title : String, stem : String } -> List ( Id, Text ) -> Question
multipleSelect data choices =
    let
        choices_ =
            choices |> List.map (\( id, text ) -> { id = id, text = text, feedback = "" })
    in
    Base.initUnsafe Base.MultipleSelect data (ChoicePrompt choices_)


{-| Create a new true-false question
-}
trueFalse : { id : String, title : String, stem : String } -> List ( Id, Text ) -> Question
trueFalse data choices =
    let
        choices_ =
            choices |> List.map (\( id, text ) -> { id = id, text = text, feedback = "" })
    in
    Base.initUnsafe Base.TrueFalse data (ChoicePrompt choices_)


{-| Create a new fill-in question
-}
fillIn : { id : String, title : String, stem : String } -> FillIn.Prompt -> Question
fillIn data body =
    Base.initUnsafe Base.FillIn data (FillInPrompt body)


{-| Create a new associative question
-}
associative :
    { id : String, title : String, stem : String }
    -> List { text : String }
    -> List { id : String, text : String }
    -> Question
associative data keys values =
    Base.initUnsafe Base.Associative data (AssociativePrompt { keys = keys, values = values })


{-| Create a new coding question
-}
codeIO : { id : String, title : String, stem : String } -> Code -> Question
codeIO data choices =
    Base.initUnsafe Base.CodeIO data (CodePrompt choices)


{-| Create a new unit test question
-}
unitTest : { id : String, title : String, stem : String } -> Code -> Question
unitTest data choices =
    Base.initUnsafe Base.UnitTest data (CodePrompt choices)
