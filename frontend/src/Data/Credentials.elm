module Data.Credentials exposing (..)

{-| Basic user/profile and credentials information stored at every login
-}

import Data.User as User exposing (User)
import Json.Decode as D
import Json.Encode as E


type alias Credentials =
    { user : User
    , token : String
    }


decoder : D.Decoder Credentials
decoder =
    D.map2 Credentials
        (D.field "user" User.decoder)
        (D.field "token" D.string)


encode : Credentials -> E.Value
encode auth =
    E.object
        [ ( "user", User.encode auth.user )
        , ( "token", E.string auth.token )
        ]
