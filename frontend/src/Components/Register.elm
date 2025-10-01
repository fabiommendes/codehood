module Components.Register exposing (Model, Msg(..), init, update, view)

{-| An empty template element
-}

import Components.Login exposing (Msg(..))
import Data.RegisterUser exposing (RegisterUser)
import Data.User as User exposing (Role(..))
import Dict exposing (Dict)
import Html as H exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (onInput, onSubmit)
import Maybe.Extra
import Util exposing (..)


type alias Key =
    String


type alias Model =
    { data : Dict Key String
    , errors : Dict String (List String)
    , role : User.Role
    , waiting : Bool
    }


type Msg
    = NoOp
    | Submit RegisterUser
    | FormChanged Key String
    | SetErrors (Dict String (List String))


init : String -> Model
init email =
    { data = Dict.fromList [ ( "email", email ) ]
    , waiting = False
    , role = User.Student
    , errors = Dict.empty
    }


update : Msg -> Model -> Model
update msg model =
    case msg of
        NoOp ->
            model

        Submit _ ->
            model

        FormChanged key value ->
            { model | data = Dict.insert key value model.data }

        SetErrors errors ->
            { model | errors = errors }


view : Model -> Html Msg
view model =
    let
        render data =
            let
                errors =
                    Dict.get data.key model.errors |> Maybe.withDefault []

                hasErrors =
                    errors /= []

                role =
                    if hasErrors then
                        "input-error"

                    else
                        "input-neutral"

                errorMessages =
                    errors
                        |> List.map (\err -> p [ class "label text-error" ] [ text err ])
            in
            fieldset [ class "fieldset" ]
                (legend [ class "fieldset-legend" ] [ text data.label ]
                    :: input [ type_ data.type_, class "input", class role, placeholder "Type here", onInput (FormChanged data.key) ] []
                    :: errorMessages
                )
    in
    H.form [ class "p-4 rounded-full", onSubmit <| Submit (getFormData model) ]
        (h2 [] [ text "New user" ]
            :: List.map render form
            ++ [ button [ class "btn btn-primary" ] [ text "Submit" ] ]
        )


form =
    [ { key = "email", label = "E-mail", type_ = "text", validators = [] }
    , { key = "name", label = "Full name", type_ = "text", validators = [] }
    , { key = "username", label = "Username", type_ = "text", validators = [] }
    , { key = "school_id", label = "School ID", type_ = "text", validators = [] }
    , { key = "github_id", label = "Github ID", type_ = "text", validators = [] }
    , { key = "signup_code", label = "Registration Code", type_ = "text", validators = [] }
    , { key = "password", label = "Password", type_ = "password", validators = [] }
    ]


getFormData : Model -> RegisterUser
getFormData model =
    let
        get key =
            Dict.get key model.data |> Maybe.withDefault ""
    in
    { name = get "name"
    , email = get "email"
    , username = get "username"
    , githubId = get "github_id"
    , schoolId = get "school_id"
    , password = get "password"
    , signupCode =
        Just (get "signup_code")
            |> Maybe.Extra.filter ((/=) "")
    }
