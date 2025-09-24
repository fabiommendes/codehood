module Data.SimpleUser exposing (SimpleUser, decoder, encode)

{-| Represent the user object in the database
-}

import Data.User exposing (Role, role)
import Json.Decode as D
import Json.Encode as E


type alias SimpleUser =
    { name : String
    , username : String
    , role : Role
    }


decoder : D.Decoder SimpleUser
decoder =
    D.map3 SimpleUser
        (D.field "name" D.string)
        (D.field "username" D.string)
        (D.field "role" role.decoder)


encode : SimpleUser -> E.Value
encode user =
    E.object
        [ ( "name", E.string user.name )
        , ( "username", E.string user.username )
        , ( "role", role.encode user.role )
        ]
