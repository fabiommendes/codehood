module Data.Classroom exposing
    ( Classroom
    , contextualMenu
    , decoder
    , empty
    , encode
    , getClassroom
    , toLink
    , toPath
    , toPathParams
    )

import Data.Discipline as Discipline exposing (Discipline)
import Data.Link as Link exposing (Link)
import Data.Menu exposing (Menu)
import Data.SimpleUser as User exposing (SimpleUser)
import Data.User
import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E
import Route.Path as Path exposing (Path)
import Ui.Icons as Icons


type alias Classroom =
    { id : String
    , title : String
    , discipline : Discipline
    , instructor : SimpleUser
    , edition : String
    , description : String
    , students : List SimpleUser
    }


empty : Classroom
empty =
    { id = ""
    , title = ""
    , discipline = Discipline.empty
    , instructor = { name = "", username = "", role = Data.User.Student }
    , edition = ""
    , description = ""
    , students = []
    }


{-| A menu from a Classroom
-}
toPath : Classroom -> Path
toPath cls =
    Path.Discipline__Classroom_ (toPathParams cls)


toPathParams : Classroom -> { discipline : String, classroom : String }
toPathParams cls =
    { discipline = cls.discipline.id
    , classroom = cls.instructor.username ++ "_" ++ cls.edition
    }


{-| A menu from a Classroom
-}
toLink : Classroom -> Link msg
toLink cls =
    Link.iconLink Icons.Home cls.title (toPath cls)


{-| A contextual menu from a Classroom
-}
contextualMenu : Classroom -> Menu a
contextualMenu cls =
    let
        params =
            toPathParams cls

        examsPath =
            Path.Discipline__Classroom__Exams params
    in
    { id = "classroom"
    , title = cls.title
    , links =
        [ Link.iconLink Icons.Cogs "Exams" examsPath
        ]
    }


{-| Return a valid classroom object from a list of enrolled classrooms from a path fragment
consisting of {discipline, classroom} slugs.
-}
getClassroom : { discipline : String, classroom : String } -> List Classroom -> Maybe Classroom
getClassroom { discipline, classroom } classrooms =
    case String.split "_" classroom of
        [ instructor, edition ] ->
            classrooms
                |> List.filter (\cls -> cls.discipline.id == discipline && cls.instructor.username == instructor && cls.edition == edition)
                |> List.head

        _ ->
            Nothing


decoder : D.Decoder Classroom
decoder =
    D.succeed Classroom
        |> D.required "id" D.string
        |> D.required "title" D.string
        |> D.required "discipline" Discipline.decoder
        |> D.required "instructor" User.decoder
        |> D.required "edition" D.string
        |> D.required "description" D.string
        |> D.required "students" (D.list User.decoder)


encode : Classroom -> E.Value
encode cls =
    E.object
        [ ( "id", E.string cls.id )
        , ( "title", E.string cls.title )
        , ( "discipline", Discipline.encode cls.discipline )
        , ( "instructor", User.encode cls.instructor )
        , ( "edition", E.string cls.edition )
        , ( "description", E.string cls.description )
        , ( "students", E.list User.encode cls.students )
        ]
