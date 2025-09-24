module Api.Classrooms exposing (..)

import Api exposing (Request)
import Api.Task as Task exposing (HttpTask)
import Data.Classroom as Data
import Data.Schedule as Schedule
import Json.Decode as D
import Json.Encode as E
import Request


getClassrooms : Request (List Data.Classroom)
getClassrooms =
    Request.get
        { url = "/classrooms/"
        , expect = Request.expectJson (D.list Data.decoder)
        }


getClassroom : String -> Request Data.Classroom
getClassroom id =
    Request.get
        { url = "/classrooms/" ++ id
        , expect = Request.expectJson Data.decoder
        }


getClassroomFromParams : { a | discipline : String, classroom : String } -> HttpTask Data.Classroom
getClassroomFromParams params =
    getId
        { classroom = params.classroom, discipline = params.discipline }
        |> Task.fromRequest
        |> Task.andThen (getClassroom >> Task.fromRequest)


getEnrolled : Request (List Data.Classroom)
getEnrolled =
    Request.get
        { url = "/classrooms/enrolled"
        , expect = Request.expectJson (D.list Data.decoder)
        }


getId :
    { classroom : String
    , discipline : String
    }
    -> Request String
getId { classroom, discipline } =
    Request.get
        { url = "/classrooms/id/" ++ discipline ++ "/" ++ classroom
        , expect = Request.expectJson D.string
        }


getSchedule : String -> Request Schedule.Schedule
getSchedule id =
    Request.get
        { url = "/classrooms/" ++ id ++ "/schedule"
        , expect = Request.expectJson Schedule.decoder
        }


enroll : String -> Request Data.Classroom
enroll code =
    Request.postJson
        { url = "/classrooms/enroll"
        , body = E.object [ ( "code", E.string code ) ]
        , decoder = Data.decoder
        }
