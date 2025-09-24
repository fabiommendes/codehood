module Data.RegisterUser exposing
    ( RegisterUser
    , decoder
    , encode
    )

import Json.Decode as D
import Json.Encode as E
import Maybe.Extra as Maybe


type alias RegisterUser =
    { name : String
    , email : String
    , username : String
    , password : String
    , githubId : String
    , schoolId : String
    , signupCode : Maybe String
    }


encode : RegisterUser -> E.Value
encode register =
    E.object
        [ ( "name", E.string register.name )
        , ( "email", E.string register.email )
        , ( "username", E.string register.username )
        , ( "password", E.string register.password )
        , ( "github_id", E.string register.githubId )
        , ( "school_id", E.string register.schoolId )
        , ( "signup_code", Maybe.unwrap E.null E.string register.signupCode )
        ]


decoder : D.Decoder RegisterUser
decoder =
    D.map7 RegisterUser
        (D.field "name" D.string)
        (D.field "email" D.string)
        (D.field "username" D.string)
        (D.field "password" D.string)
        (D.field "github_id" D.string)
        (D.field "school_id" D.string)
        (D.maybe (D.field "signup_code" D.string))
