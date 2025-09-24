module Data._Question.Essay exposing (Answer, Prompt(..), decode, encode)

import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E


type Prompt
    = Text
    | RichText
    | Code String


type alias Answer =
    { text : String }


encode : Prompt -> E.Value
encode type_ =
    case type_ of
        Text ->
            E.string "text"

        RichText ->
            E.string "rich-text"

        Code "" ->
            E.string "code"

        Code lang ->
            E.string lang


decode : D.Decoder Prompt
decode =
    D.string
        |> D.andThen
            (\type_ ->
                case type_ of
                    "text" ->
                        D.succeed Text

                    "rich-text" ->
                        D.succeed RichText

                    "code" ->
                        D.succeed (Code "")

                    _ ->
                        D.succeed (Code type_)
            )
