module Api.Disciplines exposing (..)

import Api exposing (Request)
import Data.Classroom as Classroom
import Data.Discipline as Discipline
import Json.Decode as D
import Request


getDisciplines : Request (List Discipline.Discipline)
getDisciplines =
    Request.get
        { url = "/disciplines"
        , expect = Request.expectJson (D.list Discipline.decoder)
        }


getDiscipline : String -> Request Discipline.Discipline
getDiscipline id =
    Request.get
        { url = "/disciplines/" ++ id
        , expect = Request.expectJson Discipline.decoder
        }


getClassrooms : String -> Request (Api.Paginated Classroom.Classroom)
getClassrooms id =
    Request.get
        { url = "/classrooms/"
        , expect = Api.expectPaginated Classroom.decoder
        }
        |> Request.withQuery "discipline" id
