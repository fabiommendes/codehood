module Components.EditProfile2 exposing (Model, Msg, empty, update, view)

import Html exposing (..)
import Html.Attributes exposing (..)


type alias Model =
    { name : String
    , gender : Maybe Gender
    , dateOfBirth : Result String Date
    , website : String
    , bio : String
    , skills : List Skill
    , mugshot : Maybe String
    }


type alias Date =
    { year : Int, month : Int, day : Int }


type Msg
    = UpdateName String
    | UpdateGender (Maybe Gender)
    | UpdateDateOfBirth (Result String Date)
    | UpdateWebsite String
    | UpdateBio String
    | AddSkill Skill
    | RemoveSkill String
    | UpdateMugshot (Maybe String)
    | Submit Model


type alias Skill =
    { id : String, name : String }


type Gender
    = Male
    | Female
    | Other


{-| An empty profile
-}
empty : Model
empty =
    { name = ""
    , gender = Nothing
    , dateOfBirth = Err ""
    , website = ""
    , bio = ""
    , skills = []
    , mugshot = Nothing
    }


update : Msg -> Model -> Model
update msg model =
    case msg of
        UpdateName name ->
            { model | name = name }

        UpdateGender gender ->
            { model | gender = gender }

        UpdateDateOfBirth date ->
            { model | dateOfBirth = date }

        UpdateWebsite website ->
            { model | website = website }

        UpdateBio bio ->
            { model | bio = bio }

        AddSkill skill ->
            { model | skills = skill :: model.skills }

        RemoveSkill skillId ->
            { model | skills = List.filter (\skill -> skill.id /= skillId) model.skills }

        UpdateMugshot mugshot ->
            { model | mugshot = mugshot }

        Submit _ ->
            -- A NoOp. The parent component will handle the submission.
            model


view : Model -> Html Msg
view _ =
    Html.form []
        [ fieldset [ class "fieldset" ]
            [ legend [ class "fieldset-legend" ] [ text "Edit profile" ]

            -- mugshot
            , label [ class "fieldset-label" ] [ text "Pick a file" ]
            , input [ type_ "file", class "file-input" ] []
            , label [ class "fieldset-label mb-2" ] [ text "Max size 2MB" ]

            -- name
            , label [ class "fieldset-label" ] [ text "What is your name?" ]
            , input [ type_ "text", class "input", placeholder "Type here" ] []

            -- date of Birth
            , label [ class "fieldset-label" ] [ text "Date of birth" ]
            , input [ type_ "date", class "input", placeholder "Type here" ] []

            -- gender
            , label [ class "fieldset-label" ] [ text "Gender" ]
            , select [ class "select" ]
                [ option [ disabled True, selected True ]
                    [ text "Select your gender" ]
                , option []
                    [ text "Male" ]
                , option []
                    [ text "Female" ]
                , option []
                    [ text "Other" ]
                ]

            -- website
            , label [ class "fieldset-label" ] [ text "Website" ]
            , input
                [ type_ "url"
                , class "input validator"
                , value "https://"
                , pattern "^(https?://)?(([a-zA-Z0-9]([a-zA-Z0-9-].*[a-zA-Z0-9])?.)+[a-zA-Z].*)?$"
                , title "Must be valid URL"
                ]
                []
            , p [ class "validator-hint" ]
                [ text "Must be valid URL" ]

            -- bio
            , label [ class "fieldset-label" ] [ text "Your bio" ]
            , textarea [ class "textarea h-24", placeholder "Bio" ] []
            , p [ class "fieldset-label" ] [ text "Describe your academic life, interests and achievements. You can use Markdown." ]
            ]
        , button [ class "btn btn-primary w-full" ] [ text "Submit" ]
        ]
