module Shared exposing
    ( Flags, decoder
    , Model, Msg
    , init, update, subscriptions
    , encode
    )

{-|

@docs Flags, decoder
@docs Model, Msg
@docs init, update, subscriptions

-}

import Api.Classrooms exposing (getEnrolled)
import Data.Classroom as Classroom exposing (Classroom)
import Data.Credentials as Credentials exposing (Credentials)
import Effect exposing (Effect, withEff, withNoEff)
import Json.Decode
import Json.Encode
import Route exposing (Route)
import Shared.Model as Model exposing (Model)
import Shared.Msg as Msg
import Util.Lens as L exposing (credentials)


type alias Model =
    Model.Model


type alias Msg =
    Msg.Msg


type alias Flags =
    { baseApiUrl : String
    , credentials : Maybe Credentials
    , classrooms : Maybe (List Classroom)
    }


encode : Flags -> Json.Encode.Value
encode flags =
    let
        nullable =
            Maybe.withDefault Json.Encode.null

        credentials =
            flags.credentials
                |> Maybe.map Credentials.encode
                |> nullable

        classrooms =
            flags.classrooms
                |> Maybe.map (Json.Encode.list Classroom.encode)
                |> nullable
    in
    Json.Encode.object
        [ ( "api", Json.Encode.string flags.baseApiUrl )
        , ( "credentials", credentials )
        , ( "classrooms", classrooms )
        ]


decoder : Json.Decode.Decoder Flags
decoder =
    Json.Decode.map3 Flags
        (Json.Decode.field "api" Json.Decode.string)
        (Json.Decode.field "credentials" <| Json.Decode.nullable Credentials.decoder)
        (Json.Decode.field "classrooms" <| Json.Decode.nullable (Json.Decode.list Classroom.decoder))


init : Result Json.Decode.Error Flags -> Route () -> ( Model, Effect Msg )
init flagsResult _ =
    let
        default =
            Model.init
    in
    case flagsResult of
        Ok { credentials, classrooms, baseApiUrl } ->
            case ( credentials, classrooms ) of
                ( Just _, Just _ ) ->
                    { default
                        | baseApiUrl = baseApiUrl
                        , classrooms = classrooms
                        , credentials = credentials
                    }
                        |> withNoEff

                ( Just _, _ ) ->
                    { default
                        | baseApiUrl = baseApiUrl
                        , credentials = credentials
                    }
                        |> withEff (Effect.sendRequest Msg.ClassroomReceived getEnrolled)

                _ ->
                    default |> withNoEff

        _ ->
            default |> withNoEff


update : Route () -> Msg -> Model -> ( Model, Effect Msg )
update _ msg model =
    case msg of
        Msg.NoOp ->
            model |> withNoEff

        Msg.StoreCredentials credentials ->
            model
                |> L.credentials.set (Just credentials)
                |> withNoEff

        Msg.ClassroomReceived (Ok classrooms) ->
            model
                |> L.classrooms.set (Just classrooms)
                |> withNoEff

        Msg.ClassroomReceived (Err err) ->
            model
                |> withEff (Effect.apiError err)

        Msg.Logout ->
            model
                |> L.credentials.set Nothing
                |> withNoEff

        Msg.Update fn ->
            model
                |> fn
                |> withNoEff


subscriptions : Route () -> Model -> Sub Msg
subscriptions _ _ =
    Sub.none
