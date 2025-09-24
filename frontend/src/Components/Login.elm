module Components.Login exposing (Model, Msg(..), clearErrors, init, reset, update, view)

{-| An empty template component
-}

import Api
import Api.Auth exposing (Error(..))
import Html exposing (..)
import Html.Attributes exposing (..)
import Html.Events exposing (onInput, onSubmit)
import Ui.Icons as Icons
import Util exposing (..)
import Util.Lens as L
import Validators


type alias Model =
    { email : String
    , password : String
    , step : Step
    , errors : List Api.FieldError
    , waiting : Bool
    }


type Step
    = AskEmail
    | ValidatingEmail
    | AskPassword
    | InvalidEmail String
    | InvalidPassword


type Msg
    = UpdateEmail String
    | UpdatePassword String
    | VerifyLogin String
    | UserVerified
    | UserInvalid
    | Register
    | Submit { email : String, password : String }


init : Model
init =
    { email = ""
    , password = ""
    , step = AskEmail
    , errors = []
    , waiting = False
    }


update : Msg -> Model -> Model
update msg model =
    case msg of
        UpdateEmail value ->
            L.email.set value model

        UpdatePassword value ->
            L.password.set value model

        VerifyLogin _ ->
            { model | waiting = True, step = ValidatingEmail }

        UserVerified ->
            { model | waiting = False, step = AskPassword }

        UserInvalid ->
            { model | waiting = False, step = InvalidEmail model.email }

        Submit { email, password } ->
            { model | email = email, password = password }

        Register ->
            model


view : Model -> Html Msg
view model =
    div [ class "bg-base-100 shadow-md rounded-lg shadow-md py-4" ]
        [ figure []
            [ img [ src "/img/code.jpg", alt "Shoes" ]
                []
            ]
        , div [ class "card-body" ]
            [ case model.step of
                AskEmail ->
                    askEmail [ iff (Validators.email model.email) "" "Invalid e-mail" ] model

                InvalidEmail email ->
                    if email == model.email then
                        askEmail [ "E-mail is not registered" ] model

                    else
                        askEmail [] model

                _ ->
                    askPassword model
            ]
        ]



-- withErrors : List Api.FieldError -> Model -> Model
-- withErrors error model =
--     { model | errors = error ++ model.errors }


clearErrors : Model -> Model
clearErrors model =
    { model | errors = [] }


reset : Model -> Model
reset model =
    { model
        | email = ""
        , password = ""
        , step = AskEmail
        , errors = []
        , waiting = False
    }


error : String -> Html msg
error st =
    if st == "" then
        text ""

    else
        p [ class "label error" ] [ text st ]


askEmail : List String -> Model -> Html Msg
askEmail errors model =
    let
        isDisabled =
            model.waiting || String.length model.email < 4 || not (Validators.email model.email)

        isRegister =
            model.step == InvalidEmail model.email

        button =
            if isRegister then
                actionButton "Register new user" isDisabled

            else
                nextButton isDisabled

        action =
            if isRegister then
                Register

            else
                VerifyLogin model.email
    in
    Html.form [ onSubmit action ]
        [ h2 [ class "card-title mt-4 mb-2" ] [ text "Bem vindos ao Codehood!" ]
        , fieldset [ class "fieldset" ]
            (legend [ class "fieldset-legend" ] [ text "E-mail" ]
                :: label [ class "input w-full validator" ]
                    [ Icons.view Icons.Person
                    , input
                        [ type_ "input"
                        , id "email"
                        , required True
                        , placeholder "Digite aqui"
                        , onInput UpdateEmail
                        , autofocus True
                        ]
                        []
                    ]
                :: List.map error errors
            )
        , button
        ]


askPassword : Model -> Html Msg
askPassword model =
    let
        alert =
            if model.step == ValidatingEmail then
                p [ class "label" ] [ text "Verifying e-mail" ]

            else
                text ""
    in
    Html.form [ onSubmit <| Submit { email = model.email, password = model.password } ]
        [ h2 [ class "card-title mt-4 mb-2" ] [ pre [] [ text model.email ] ]
        , fieldset [ class "fieldset" ]
            [ legend [ class "fieldset-legend" ] [ text "Senha" ]
            , label [ class "input w-full validator" ]
                [ input
                    [ class "hidden"
                    , type_ "input"
                    , id "email"
                    , required True
                    , autofocus False
                    , value model.email
                    , disabled True
                    ]
                    []
                , input
                    [ type_ "password"
                    , id "password"
                    , required True
                    , placeholder "Digite aqui"
                    , onInput UpdatePassword
                    , autofocus True
                    , disabled (model.step /= AskPassword)
                    ]
                    [ text model.password ]
                ]
            , alert
            ]
        , nextButton (model.waiting || String.length model.password <= 4)
        ]


nextButton : Bool -> Html msg
nextButton disable =
    actionButton "Próximo" disable


actionButton : String -> Bool -> Html msg
actionButton display disable =
    div [ class "card-actions justify-end my-4 absolute bottom-4 right-8" ]
        [ button
            [ class "btn btn-primary"
            , disabled disable
            ]
            [ text display, Icons.view Icons.ArrowRight ]
        ]
