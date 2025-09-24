module Data.User exposing
    ( Role(..)
    , User
    , decoder
    , encode
    , role
    )

{-| Represent the user object in the database
-}

import Json.Decode as D
import Json.Encode as E


type alias User =
    { name : String
    , email : String
    , username : String
    , role : Role
    , githubId : String
    , schoolId : String
    }


type Role
    = Student
    | Instructor
    | Admin


encode : User -> E.Value
encode user =
    E.object
        [ ( "name", E.string user.name )
        , ( "email", E.string user.email )
        , ( "username", E.string user.username )
        , ( "role", role.encode user.role )
        , ( "github_id", E.string user.githubId )
        , ( "school_id", E.string user.schoolId )
        ]


decoder : D.Decoder User
decoder =
    D.map6 User
        (D.field "name" D.string)
        (D.field "email" D.string)
        (D.field "username" D.string)
        (D.field "role" role.decoder)
        (D.field "github_id" D.string)
        (D.field "school_id" D.string)


role :
    { encode : Role -> E.Value
    , decoder : D.Decoder Role
    }
role =
    { encode =
        \role_ ->
            case role_ of
                Instructor ->
                    E.int 1

                Student ->
                    E.int 2

                Admin ->
                    E.int 3
    , decoder =
        D.int
            |> D.andThen
                (\role_ ->
                    case role_ of
                        1 ->
                            D.succeed Instructor

                        2 ->
                            D.succeed Student

                        3 ->
                            D.succeed Admin

                        _ ->
                            D.fail ("Invalid role: " ++ String.fromInt role_)
                )
    }
