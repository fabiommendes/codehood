module Shared.Msg exposing (Msg(..))

{-| The shared message model
-}

import Api
import Data.Classroom exposing (Classroom)
import Data.Credentials exposing (Credentials)
import Shared.Model exposing (Model)


{-| Normally, this value would live in "Shared.elm"
but that would lead to a circular dependency import cycle.

For that reason, both `Shared.Model` and `Shared.Msg` are in their
own file, so they can be imported by `Effect.elm`

-}
type Msg
    = NoOp
    | Logout
    | StoreCredentials Credentials
    | ClassroomReceived (Result Api.Error (List Classroom))
    | Update (Model -> Model)
