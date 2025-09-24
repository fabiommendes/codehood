module Mdq.Types exposing
    ( ArtifactType, AssociativeItemImage, AssociativeItemKeyImage, AssociativeItemKeyText, AssociativeItemText
    , AssociativeQuestion, Choice, CodeIoConf, CodingIOQuestion, Compilation, Environment, Essay, Exam
    , FillInInputNumeric, FillInInputSelection, FillInInputText, FillInTheBlankQuestion
    , Grading, IoAnswerKey, IospecAnswerKey, Linting, MultipleChoiceGradingStrategy
    , MultipleChoiceItem, MultipleChoiceQuestion, MultipleSelectionQuestion, Shuffle, Timeout
    , TrueFalseGradingStrategy, TrueFalseItem, TrueFalseQuestion, UnitTestQuestion
    )

{-|


## Aliases

@docs ArtifactType, AssociativeItemImage, AssociativeItemKeyImage, AssociativeItemKeyText, AssociativeItemText
@docs AssociativeQuestion, Choice, CodeIoConf, CodingIOQuestion, Compilation, Environment, Essay, Exam
@docs FillInInputNumeric, FillInInputSelection, FillInInputText, FillInTheBlankQuestion, Footnote, GradeRange
@docs Grading, IoAnswerKey, IospecAnswerKey, Linting, MediaObject, MediaType, MultipleChoiceGradingStrategy
@docs MultipleChoiceItem, MultipleChoiceQuestion, MultipleSelectionQuestion, Shuffle, TextFormat, Timeout
@docs TrueFalseGradingStrategy, TrueFalseItem, TrueFalseQuestion, UnitTestQuestion

-}

import Array exposing (Array)
import Json.Encode
import Mdq.Question exposing (..)
import OpenApi.Common


type alias TrueFalseItem =
    { correct : Bool, feedback : String, fixed : Bool, text : String }


type alias TrueFalseGradingStrategy =
    { correct : Float, incorrect : Float }


type alias Timeout =
    String


type alias Shuffle =
    String


type alias MultipleChoiceGradingStrategy =
    String


type alias Linting =
    { type_ : OpenApi.Common.Nullable String }


type alias IospecAnswerKey =
    { iospec : String }


type alias IoAnswerKey =
    { input : String, output : OpenApi.Common.Nullable String }


type alias Grading =
    { strategy : Maybe TrueFalseGradingStrategy }


type alias FillInInputText =
    { answer_key : String, case_sensitive : Bool, type_ : String }


type alias FillInInputSelection =
    { choices : List MultipleChoiceItem, type_ : String }


type alias FillInInputNumeric =
    { answer_key : Float
    , relative_tol : Float
    , tol : Float
    , type_ : String
    , unit : String
    }


type alias Exam =
    { id : String
    , preamble : String
    , questions : List Json.Encode.Value
    , tags : List String
    , title : String
    }


type alias Environment =
    { type_ : OpenApi.Common.Nullable String }


type alias Compilation =
    { artifact : OpenApi.Common.Nullable String
    , artifact_type : ArtifactType
    , type_ : OpenApi.Common.Nullable String
    }


type alias CodeIoConf =
    { case_sensitive : Bool, ignore_accents : Bool, match_spaces : Bool }


type alias Choice =
    { correct : Bool, feedback : String, fixed : Bool, text : String }


type alias AssociativeItemText =
    { style : String, text : String }


type alias AssociativeItemKeyText =
    { answer_key : List String, feedback : {}, style : String, text : String }


type alias AssociativeItemKeyImage =
    { alt : String, answer_key : List String, feedback : {}, url : String }


type alias AssociativeItemImage =
    { alt : String, url : String }


type alias ArtifactType =
    String
