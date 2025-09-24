module Data.Discipline exposing (Discipline, decoder, empty, encode, toLink, toPath, toPathParams)

import Data.Link as Link exposing (Link)
import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E
import Route.Path as Path exposing (Path)


type alias Discipline =
    { id : String
    , name : String
    , description : String
    }


empty : Discipline
empty =
    { id = ""
    , name = ""
    , description = ""
    }


toPath : Discipline -> Path
toPath data =
    Path.Discipline_ (toPathParams data)


toPathParams : Discipline -> { discipline : String }
toPathParams data =
    { discipline = data.id }


{-| A menu from a Discipline
-}
toLink : Discipline -> Link msg
toLink data =
    Link.link data.name (toPath data)


decoder : D.Decoder Discipline
decoder =
    D.succeed Discipline
        |> D.required "slug" D.string
        |> D.required "name" D.string
        |> D.optional "description" D.string ""


encode : Discipline -> E.Value
encode data =
    E.object
        [ ( "slug", E.string data.id )
        , ( "name", E.string data.name )
        , ( "description", E.string data.description )
        ]
