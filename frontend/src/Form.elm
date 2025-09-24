module Form exposing (..)

import Dict exposing (Dict)


type alias Field =
    { id : String
    , label : Maybe String
    , placeholder : Maybe String
    , kind : Input
    }


type alias FieldState =
    { data : Maybe String
    , error : Maybe String
    }


type alias FormState =
    { data : Dict String FieldState
    , submitting : Bool
    }


type Input
    = Text
    | Number
    | Password


field_ : Input -> String -> Field
field_ kind id =
    { id = id
    , label = Nothing
    , placeholder = Nothing
    , kind = kind
    }


field : String -> Field
field =
    field_ Text


password : String -> Field
password =
    field_ Password


label : a -> { m | label : Maybe a } -> { m | label : Maybe a }
label value m =
    { m | label = Just value }


placeholder : a -> { m | placeholder : Maybe a } -> { m | placeholder : Maybe a }
placeholder value m =
    { m | placeholder = Just value }
