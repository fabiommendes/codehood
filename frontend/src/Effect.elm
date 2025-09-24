port module Effect exposing
    ( Effect
    , none, batch
    , sendCmd, sendMsg
    , pushRoute, replaceRoute, pushRoutePath, replaceRoutePath, loadExternalUrl, back
    , map, toCmd
    , logout
    , apiError, attempt, attemptHttp, authenticate, collectEff, debug, delayMsg, error, info, navbarSections, perform, pushUrl, runTask, sendRequest, sharedMsg, warn, withApiError, withEff, withEffs, withInnerEff, withNoEff
    )

{-|

@docs Effect


# Basic effects

@docs none, batch
@docs sendCmd, sendMsg


# Routing

@docs pushRoute, replaceRoute, pushRoutePath, replaceRoutePath, loadExternalUrl, back


# Utility/ internal functions

@docs map, toCmd


# Api integration

@docs sendApiRequest, login, logout, saveCSRF, clearCSRF

-}

import Api exposing (Error, Request)
import Api.Error
import Api.Task exposing (HttpTask)
import Browser.Navigation
import Data.Classroom as Classroom
import Data.Credentials as Credentials exposing (Credentials)
import Data.Menu exposing (StaticMenu)
import Dict exposing (Dict)
import Effect.Layout as LayoutMsg
import Effect.Log as Log
import Json.Decode as D
import Json.Encode as E
import Process
import Request
import Result.Extra as Result
import Route
import Route.Path
import Shared.Model
import Shared.Msg
import Task exposing (Task)
import Url exposing (Protocol(..), Url)
import Util.Lens exposing (Lens)


type Effect msg
    = -- BASICS
      None
    | Batch (List (Effect msg))
    | SendCmd (Cmd msg)
      -- ROUTING
    | PushUrl String
    | ReplaceUrl String
    | LoadExternalUrl String
    | Back
      -- SHARED
    | SendSharedMsg Shared.Msg.Msg
    | SendToLocalStorage { key : String, value : E.Value }
      -- CUSTOM
    | SendApiRequest
        { request : Request msg
        , onError : Api.Error -> msg
        }
    | HttpTask
        { toTask : Shared.Model.Model -> Task Error msg
        , onError : Api.Error -> msg
        }


port sendToLocalStorage : { key : String, value : E.Value } -> Cmd msg



-- BASICS


{-| Don't send any effect.
-}
none : Effect msg
none =
    None


{-| Send multiple effects at once.
-}
batch : List (Effect msg) -> Effect msg
batch =
    Batch


{-| Send a normal `Cmd msg` as an effect, something like `Http.get` or `Random.generate`.
-}
sendCmd : Cmd msg -> Effect msg
sendCmd =
    SendCmd


{-| Task.attempt, but for effects
-}
attempt : (Result err a -> msg) -> Task err a -> Effect msg
attempt onResponse task =
    task
        |> Task.attempt onResponse
        |> sendCmd


{-| Task.perform, but for effects
-}
perform : (a -> msg) -> Task Never a -> Effect msg
perform onResponse task =
    task
        |> Task.perform onResponse
        |> sendCmd


{-| Similar to perform, but split the error and success messages
-}
runTask : { onError : error -> msg, onSuccess : a -> msg } -> Task error a -> Effect msg
runTask { onError, onSuccess } task =
    task
        |> Task.attempt (Result.unpack onError onSuccess)
        |> sendCmd


{-| Send a message as an effect. Useful when emitting events from UI components.
-}
sendMsg : msg -> Effect msg
sendMsg msg =
    Task.succeed msg
        |> Task.perform identity
        |> SendCmd


{-| Send a global message from the Shared.Msg
-}
sharedMsg : Shared.Msg.Msg -> Effect msg
sharedMsg msg =
    SendSharedMsg msg


{-| Send a message with some delay in milliseconds.
-}
delayMsg : Float -> msg -> Effect msg
delayMsg millis msg =
    Process.sleep millis
        |> Task.andThen (always (Task.succeed msg))
        |> Task.perform identity
        |> SendCmd


{-| Set the new route, and make the back button go back to the current route.
-}
pushRoute :
    { path : Route.Path.Path
    , query : Dict String String
    , hash : Maybe String
    }
    -> Effect msg
pushRoute route =
    PushUrl (Route.toString route)


{-| Same as `Effect.pushRoute`, but without `query` or `hash` support
-}
pushRoutePath : Route.Path.Path -> Effect msg
pushRoutePath path =
    PushUrl (Route.Path.toString path)


{-| Same as `Effect.pushRoutePath`, but uses raw URLs.

Not recommended in most cases.

-}
pushUrl : String -> Effect msg
pushUrl url =
    PushUrl url


{-| Set the new route, but replace the previous one, so clicking the back
button **won't** go back to the previous route.
-}
replaceRoute :
    { path : Route.Path.Path
    , query : Dict String String
    , hash : Maybe String
    }
    -> Effect msg
replaceRoute route =
    ReplaceUrl (Route.toString route)


{-| Same as `Effect.replaceRoute`, but without `query` or `hash` support
-}
replaceRoutePath : Route.Path.Path -> Effect msg
replaceRoutePath path =
    ReplaceUrl (Route.Path.toString path)


{-| Redirect users to a new URL, somewhere external to your web application.
-}
loadExternalUrl : String -> Effect msg
loadExternalUrl =
    LoadExternalUrl


{-| Navigate back one page
-}
back : Effect msg
back =
    Back


{-| Send a POST request using the user credentials, if avaiable
-}
sendRequest : (Result Api.Error value -> msg) -> Request value -> Effect msg
sendRequest onResponse request =
    SendApiRequest
        { request = Request.map (Ok >> onResponse) request
        , onError = Err >> onResponse
        }


{-| Send a POST request using the user credentials, if avaiable
-}
attemptHttp : (Result Api.Error value -> msg) -> HttpTask value -> Effect msg
attemptHttp onResponse task =
    HttpTask
        { toTask =
            task
                |> Api.Task.map (Ok >> onResponse)
                |> Api.Task.toTask
        , onError = Err >> onResponse
        }


{-| Authenticate a user
-}
authenticate : Credentials -> Effect msg
authenticate credentials =
    batch
        [ SendSharedMsg (Shared.Msg.StoreCredentials credentials)
        , SendToLocalStorage
            { key = "credentials"
            , value = Credentials.encode credentials
            }
        ]


{-| Executed after user logout

Clear the CSRF token in the model

-}
logout : Effect msg
logout =
    batch
        [ SendSharedMsg Shared.Msg.Logout
        , SendToLocalStorage { key = "user", value = E.null }
        , pushRoutePath Route.Path.Auth_Login
        ]



--- DEBUG FUNCTIONS


{-| Logs an API error
-}
apiError : Api.Error -> Effect msg
apiError err =
    warn "Api Error" (Api.Error.encode err)


{-| Sends a value to consle.log
-}
debug : String -> E.Value -> Effect msg
debug message data =
    SendCmd <| Log.log Log.Debug message data


{-| Sends a value to consle.log
-}
info : String -> E.Value -> Effect msg
info message data =
    SendCmd <| Log.log Log.Info message data


{-| Sends a value to consle.log
-}
warn : String -> E.Value -> Effect msg
warn message data =
    SendCmd <| Log.log Log.Warning message data


{-| Sends a value to consle.log
-}
error : String -> E.Value -> Effect msg
error message data =
    SendCmd <| Log.log Log.Error message data



--- SEND MESSAGES TO LAYOUT


{-| Declare some sections for the use of the navbar
-}
navbarSections : List StaticMenu -> Effect msg
navbarSections sections =
    SendCmd <| LayoutMsg.sendMessage (LayoutMsg.AddNavbarSections sections)



--- MAPPING, CHAINING AND TRANSFORMING EFFECTS


{-| Elm Land depends on this function to connect pages and layouts
together into the overall app.
-}
map : (msg1 -> msg2) -> Effect msg1 -> Effect msg2
map fn effect =
    case effect of
        None ->
            None

        Batch list ->
            Batch (List.map (map fn) list)

        SendCmd cmd ->
            SendCmd (Cmd.map fn cmd)

        PushUrl url ->
            PushUrl url

        ReplaceUrl url ->
            ReplaceUrl url

        Back ->
            Back

        LoadExternalUrl url ->
            LoadExternalUrl url

        SendSharedMsg msg ->
            SendSharedMsg msg

        SendToLocalStorage item ->
            SendToLocalStorage item

        SendApiRequest data ->
            SendApiRequest
                { request = Request.map fn data.request
                , onError = fn << data.onError
                }

        HttpTask { toTask, onError } ->
            HttpTask
                { toTask = toTask >> Task.map fn
                , onError = onError >> fn
                }


{-| Elm Land depends on this function to perform your effects.
-}
toCmd :
    { key : Browser.Navigation.Key
    , url : Url
    , shared : Shared.Model.Model
    , fromSharedMsg : Shared.Msg.Msg -> msg
    , batch : List msg -> msg
    , toCmd : msg -> Cmd msg
    }
    -> Effect msg
    -> Cmd msg
toCmd options effect =
    case effect of
        None ->
            Cmd.none

        Batch list ->
            Cmd.batch (List.map (toCmd options) list)

        SendCmd cmd ->
            cmd

        PushUrl url ->
            Browser.Navigation.pushUrl options.key url

        ReplaceUrl url ->
            Browser.Navigation.replaceUrl options.key url

        Back ->
            Browser.Navigation.back options.key 1

        LoadExternalUrl url ->
            Browser.Navigation.load url

        SendSharedMsg msg ->
            Task.succeed msg
                |> Task.perform options.fromSharedMsg

        SendToLocalStorage item ->
            sendToLocalStorage item

        SendApiRequest { request, onError } ->
            request
                |> Request.cmd (Api.config options.shared) (Result.extract onError)

        HttpTask { toTask, onError } ->
            toTask options.shared
                |> Task.attempt (Result.extract onError)



--- UTILITY FUNCTIONS THAT INTERACTS WITH (model, eff) TUPLES


{-| Used on update and init functions:

Instead of

    ( model, Effect.none )

Write

    model |> withNoEff

This is more ammenable to a pipeline style programming.

-}
withNoEff : model -> ( model, Effect msg )
withNoEff model =
    ( model
    , none
    )


{-| Used on update and init functions:

Instead of

    ( model, eff )

Write

    model |> withEff eff

This is more ammenable to a pipeline style programming.

-}
withEff : Effect msg -> model -> ( model, Effect msg )
withEff eff model =
    ( model
    , eff
    )


{-| A convenience method to pass more than one effect
-}
withEffs : List (Effect msg) -> model -> ( model, Effect msg )
withEffs effs model =
    case effs of
        [] ->
            ( model, None )

        [ eff ] ->
            ( model, eff )

        _ ->
            ( model, Batch effs )


{-| Used on update and init functions:

Instead of

    let
        ( child, effect ) =
            Child.update ChildMsg model.child
    in
    ( { model | child = child }
    , Effect.map ChildMsg effect
    )

Write

    model
        |> withInnerEff childLens
            { update = Child.update msg
            , msg = ChildMsg
            }

Where lens is created using Util.Lens or simply by creating a record
of functions

    chilLens =
        { get = .child, set = \value m -> { m | child = value } }

-}
withInnerEff :
    Lens model subModel
    ->
        { update : subModel -> ( subModel, Effect subMsg )
        , msg : subMsg -> msg
        }
    -> model
    -> ( model, Effect msg )
withInnerEff lens { update, msg } model =
    let
        ( subModel, effect ) =
            update (lens.get model)
    in
    ( lens.set subModel model, map msg effect )


{-| Collect a list of effects and values
-}
collectEff : List ( a, Effect msg ) -> ( List a, Effect msg )
collectEff pairs =
    let
        ( data, effs ) =
            List.unzip pairs
    in
    ( data, batch effs )


{-| Register API errors that we dont want to handle
-}
withApiError : Api.Error -> model -> ( model, Effect msg )
withApiError err =
    withEff (apiError err)
