module Api.Exams exposing (..)

import Api exposing (Request)
import Data.Exam as Data
import Json.Decode as D
import Json.Encode as E
import Request


getExams : Request (Api.Paginated Data.Exam)
getExams =
    Request.get
        { url = "/exams/"
        , expect = Api.expectPaginated Data.decoder
        }


getExamsForClassroom : String -> Request (Api.Paginated Data.Exam)
getExamsForClassroom id =
    Request.get
        { url = "/exams/"
        , expect = Api.expectPaginated Data.decoder
        }
        |> Request.withQuery "classroom" id


getExam : String -> Request Data.Exam
getExam id =
    Request.get
        { url = "/exams/" ++ id
        , expect = Request.expectJson Data.decoder
        }


postAnswer : { params : Data.PathParams, answer : E.Value } -> Request String
postAnswer { params, answer } =
    let
        id =
            Data.paramsToNaturalId params
    in
    Request.postJson
        { url = "/exams/" ++ id ++ "/answers"
        , decoder = D.string
        , body = answer
        }
