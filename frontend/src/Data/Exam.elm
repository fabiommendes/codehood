module Data.Exam exposing
    ( Exam
    , PathParams
    , Role(..)
    , decoder
    , empty
    , encode
    , paramsToNaturalId
    , toLink
    , toPath
    , toPathParams
    )

import Data.Classroom exposing (Classroom)
import Data.Datetime exposing (encodePosix, posixDecoder)
import Data.Link exposing (Link)
import Data.Question as Question exposing (Question)
import Json.Decode as D
import Json.Decode.Pipeline as D
import Json.Encode as E
import Json.Encode.Extra as E
import Route.Path as Path
import Time exposing (Posix)
import Util.EnumDecode exposing (enumDecode, enumEncode, fromEnum)


{-| Elm representation of an Exam
-}
type alias Exam =
    { id : String
    , numQuestions : Int
    , classroomId : String
    , instructorId : String
    , instructorName : String
    , slug : String
    , title : String
    , role : Role
    , description : String
    , preamble : String
    , start : Posix
    , end : Maybe Posix
    , tags : List String
    , questions : List Question
    }


type Role
    = RoleQuiz
    | RoleExam
    | RolePractice
    | RoleArchived
    | RoleInactive


empty : Exam
empty =
    { id = ""
    , numQuestions = 0
    , classroomId = ""
    , instructorId = ""
    , instructorName = ""
    , slug = ""
    , title = ""
    , role = RoleInactive
    , description = ""
    , preamble = ""
    , start = Time.millisToPosix 0
    , end = Nothing
    , tags = []
    , questions = []
    }


type alias PathParams =
    { discipline : String
    , classroom : String
    , role : String
    , exam : String
    }


paramsToNaturalId : PathParams -> String
paramsToNaturalId { discipline, classroom, role, exam } =
    "(" ++ String.join "," [ discipline, classroom, role, exam ] ++ ")"


toPathParams : Classroom -> Exam -> PathParams
toPathParams cls exam =
    let
        { discipline, classroom } =
            Data.Classroom.toPathParams cls
    in
    { discipline = discipline
    , classroom = classroom
    , exam = exam.slug
    , role = roleToString exam.role
    }


toPath : Classroom -> Exam -> Path.Path
toPath cls exam =
    Path.Discipline__Classroom__Role__Exam_ (toPathParams cls exam)


toLink : Classroom -> Exam -> Link msg
toLink cls exam =
    Data.Link.link exam.title (toPath cls exam)


decoder : D.Decoder Exam
decoder =
    D.succeed Exam
        |> D.required "id" D.string
        |> D.required "num_questions" D.int
        |> D.required "classroom_id" D.string
        |> D.required "instructor_id" D.string
        |> D.required "instructor_name" D.string
        |> D.required "slug" D.string
        |> D.required "title" D.string
        |> D.required "role" decodeRole
        |> D.required "description" D.string
        |> D.required "preamble" D.string
        |> D.required "start" posixDecoder
        |> D.required "end" (D.nullable posixDecoder)
        |> D.required "tags" (D.list D.string)
        |> D.required "questions" (D.list Question.decoder)


encode : Exam -> E.Value
encode exam =
    E.object
        [ ( "id", E.string exam.id )
        , ( "num_questions", E.int exam.numQuestions )
        , ( "classroom_id", E.string exam.classroomId )
        , ( "instructor_id", E.string exam.instructorId )
        , ( "instructor_name", E.string exam.instructorName )
        , ( "slug", E.string exam.slug )
        , ( "title", E.string exam.title )
        , ( "role", encodeRole exam.role )
        , ( "description", E.string exam.description )
        , ( "preamble", E.string exam.preamble )
        , ( "start", encodePosix exam.start )
        , ( "end", E.maybe encodePosix exam.end )
        , ( "tags", E.list E.string exam.tags )
        , ( "questions", E.list Question.encode exam.questions )
        ]


roleMap : List ( Role, String )
roleMap =
    [ ( RoleQuiz, "quiz" )
    , ( RoleExam, "exam" )
    , ( RolePractice, "practice" )
    , ( RoleArchived, "archived" )
    , ( RoleInactive, "inactive" )
    ]


decodeRole : D.Decoder Role
decodeRole =
    enumDecode roleMap D.string


encodeRole : Role -> E.Value
encodeRole =
    enumEncode roleMap E.string


roleToString : Role -> String
roleToString role =
    fromEnum roleMap role
