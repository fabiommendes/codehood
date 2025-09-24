module Ui.DaisyUi exposing (asDaisyHtml, daisyUiViewConfig)

import Form exposing (Form)
import Form.Error as Error exposing (Error)
import Form.View
    exposing
        ( CheckboxFieldConfig
        , CustomConfig
        , FormConfig
        , FormListConfig
        , FormListItemConfig
        , Model
        , NumberFieldConfig
        , RadioFieldConfig
        , RangeFieldConfig
        , SelectFieldConfig
        , State(..)
        , TextFieldConfig
        , ViewConfig
        )
import Html as H exposing (Html)
import Html.Attributes as HA
import Html.Events as HE
import Json.Decode


asDaisyHtml : ViewConfig values msg -> Form values msg -> Model values -> Html msg
asDaisyHtml =
    Form.View.custom daisyUiViewConfig


daisyUiViewConfig : CustomConfig msg (Html msg)
daisyUiViewConfig =
    { form = form
    , textField = inputField "text"
    , emailField = inputField "email"
    , passwordField = inputField "password"
    , searchField = inputField "search"
    , textareaField = textareaField
    , numberField = numberField
    , rangeField = rangeField
    , checkboxField = checkboxField
    , radioField = radioField
    , selectField = selectField
    , group = group
    , section = section
    , formList = formList
    , formListItem = formListItem
    }


formList : FormListConfig msg (Html msg) -> Html msg
formList { forms, label, add, disabled } =
    let
        addButton =
            case ( disabled, add ) of
                ( False, Just add_ ) ->
                    H.button
                        [ HE.onClick add_.action
                        , HA.type_ "button"
                        ]
                        [ H.i [ HA.class "fas fa-plus" ] []
                        , H.text add_.label
                        ]
                        |> H.map (\f -> f ())

                _ ->
                    H.text ""
    in
    H.div [ HA.class "elm-form-list" ]
        (fieldLabel label
            :: (forms ++ [ addButton ])
        )


formListItem : FormListItemConfig msg (Html msg) -> Html msg
formListItem { fields, delete, disabled } =
    let
        deleteButton =
            case ( disabled, delete ) of
                ( False, Just delete_ ) ->
                    H.button
                        [ HE.onClick delete_.action
                        , HA.type_ "button"
                        ]
                        [ H.text delete_.label
                        , H.i [ HA.class "fas fa-times" ] []
                        ]
                        |> H.map (\f -> f ())

                _ ->
                    H.text ""
    in
    H.div [ HA.class "elm-form-list-item" ]
        (deleteButton :: fields)


form : FormConfig msg (Html msg) -> Html msg
form { onSubmit, action, loading, state, fields } =
    let
        onSubmitEvent =
            onSubmit
                |> Maybe.map (HE.onSubmit >> List.singleton)
                |> Maybe.withDefault []
    in
    H.form (HA.class "elm-form" :: onSubmitEvent)
        (List.concat
            [ fields
            , [ case state of
                    Error error ->
                        errorMessage error

                    Success success ->
                        successMessage success

                    _ ->
                        H.text ""
              , H.button
                    [ HA.type_ "submit"
                    , HA.disabled (onSubmit == Nothing)
                    ]
                    [ if state == Loading then
                        H.text loading

                      else
                        H.text action
                    ]
              ]
            ]
        )


inputField : String -> TextFieldConfig msg -> Html msg
inputField type_ { onChange, onBlur, disabled, value, error, showError, attributes } =
    H.input
        ([ HE.onInput onChange
         , HA.disabled disabled
         , HA.value value
         , HA.placeholder attributes.placeholder
         , HA.type_ type_
         ]
            |> withMaybeAttribute HE.onBlur onBlur
            |> withHtmlAttributes attributes.htmlAttributes
        )
        []
        |> withLabelAndError attributes.label showError error


textareaField : TextFieldConfig msg -> Html msg
textareaField { onChange, onBlur, disabled, value, error, showError, attributes } =
    H.textarea
        ([ HE.onInput onChange
         , HA.disabled disabled
         , HA.placeholder attributes.placeholder
         , HA.value value
         ]
            |> withMaybeAttribute HE.onBlur onBlur
            |> withHtmlAttributes attributes.htmlAttributes
        )
        []
        |> withLabelAndError attributes.label showError error


numberField : NumberFieldConfig msg -> Html msg
numberField { onChange, onBlur, disabled, value, error, showError, attributes } =
    let
        stepAttr =
            attributes.step
                |> Maybe.map String.fromFloat
                |> Maybe.withDefault "any"
    in
    H.input
        ([ HE.onInput onChange
         , HA.disabled disabled
         , HA.value value
         , HA.placeholder attributes.placeholder
         , HA.type_ "number"
         , HA.step stepAttr
         ]
            |> withMaybeAttribute (String.fromFloat >> HA.max) attributes.max
            |> withMaybeAttribute (String.fromFloat >> HA.min) attributes.min
            |> withMaybeAttribute HE.onBlur onBlur
            |> withHtmlAttributes attributes.htmlAttributes
        )
        []
        |> withLabelAndError attributes.label showError error


rangeField : RangeFieldConfig msg -> Html msg
rangeField { onChange, onBlur, disabled, value, error, showError, attributes } =
    H.div
        [ HA.class "elm-form-range-field" ]
        [ H.input
            ([ HE.onInput (fromString String.toFloat value >> onChange)
             , HA.disabled disabled
             , HA.value (value |> Maybe.map String.fromFloat |> Maybe.withDefault "")
             , HA.type_ "range"
             , HA.step (String.fromFloat attributes.step)
             ]
                |> withMaybeAttribute (String.fromFloat >> HA.max) attributes.max
                |> withMaybeAttribute (String.fromFloat >> HA.min) attributes.min
                |> withMaybeAttribute HE.onBlur onBlur
                |> withHtmlAttributes attributes.htmlAttributes
            )
            []
        , H.span [] [ H.text (value |> Maybe.map String.fromFloat |> Maybe.withDefault "") ]
        ]
        |> withLabelAndError attributes.label showError error


checkboxField : CheckboxFieldConfig msg -> Html msg
checkboxField { onChange, onBlur, value, disabled, error, showError, attributes } =
    [ H.div [ HA.class "elm-form-label" ]
        [ H.input
            ([ HE.onCheck onChange
             , HA.checked value
             , HA.disabled disabled
             , HA.type_ "checkbox"
             ]
                |> withMaybeAttribute HE.onBlur onBlur
                |> withHtmlAttributes attributes.htmlAttributes
            )
            []
        , H.text attributes.label
        ]
    , maybeErrorMessage showError error
    ]
        |> wrapInFieldContainer showError error


radioField : RadioFieldConfig msg -> Html msg
radioField { onChange, onBlur, disabled, value, error, showError, attributes } =
    let
        radio ( key, label ) =
            H.label []
                [ H.input
                    ([ HA.name attributes.label
                     , HA.value key
                     , HA.checked (value == key)
                     , HA.disabled disabled
                     , HA.type_ "radio"
                     , HE.onClick (onChange key)
                     ]
                        |> withMaybeAttribute HE.onBlur onBlur
                        |> withHtmlAttributes attributes.htmlAttributes
                    )
                    []
                , H.text label
                ]
    in
    H.div (fieldContainerAttributes showError error)
        ((fieldLabel attributes.label
            :: List.map radio attributes.options
         )
            ++ [ maybeErrorMessage showError error ]
        )


selectField : SelectFieldConfig msg -> Html msg
selectField { onChange, onBlur, disabled, value, error, showError, attributes } =
    let
        toOption ( key, label_ ) =
            H.option
                [ HA.value key
                , HA.selected (value == key)
                ]
                [ H.text label_ ]

        placeholderOption =
            H.option
                [ HA.disabled True
                , HA.selected (value == "")
                ]
                [ H.text ("-- " ++ attributes.placeholder ++ " --") ]
    in
    H.select
        ([ HE.on "change" (Json.Decode.map onChange HE.targetValue)
         , HA.disabled disabled
         ]
            |> withMaybeAttribute HE.onBlur onBlur
            |> withHtmlAttributes attributes.htmlAttributes
        )
        (placeholderOption :: List.map toOption attributes.options)
        |> withLabelAndError attributes.label showError error


group : List (Html msg) -> Html msg
group =
    H.div [ HA.class "elm-form-group" ]


section : String -> List (Html msg) -> Html msg
section title fields =
    H.fieldset []
        (H.legend [] [ H.text title ]
            :: fields
        )


wrapInFieldContainer : Bool -> Maybe Error -> List (Html msg) -> Html msg
wrapInFieldContainer showError error =
    H.label (fieldContainerAttributes showError error)


fieldContainerAttributes : Bool -> Maybe Error -> List (H.Attribute msg)
fieldContainerAttributes showError error =
    [ HA.classList
        [ ( "elm-form-field", True )
        , ( "elm-form-field-error", showError && error /= Nothing )
        ]
    ]


withLabelAndError : String -> Bool -> Maybe Error -> Html msg -> Html msg
withLabelAndError label showError error fieldAsHtml =
    [ fieldLabel label
    , fieldAsHtml
    , maybeErrorMessage showError error
    ]
        |> wrapInFieldContainer showError error


fieldLabel : String -> Html msg
fieldLabel label =
    H.div [ HA.class "elm-form-label" ] [ H.text label ]


maybeErrorMessage : Bool -> Maybe Error -> Html msg
maybeErrorMessage showError maybeError =
    case maybeError of
        Just (Error.External externalError) ->
            errorMessage externalError

        _ ->
            if showError then
                maybeError
                    |> Maybe.map errorToString
                    |> Maybe.map errorMessage
                    |> Maybe.withDefault (H.text "")

            else
                H.text ""


successMessage : String -> Html msg
successMessage =
    H.text >> List.singleton >> H.div [ HA.class "elm-form-success" ]


errorMessage : String -> Html msg
errorMessage =
    H.text >> List.singleton >> H.div [ HA.class "elm-form-error" ]


errorToString : Error -> String
errorToString error =
    case error of
        Error.RequiredFieldIsEmpty ->
            "This field is required"

        Error.ValidationFailed validationError ->
            validationError

        Error.External externalError ->
            externalError


withMaybeAttribute : (a -> H.Attribute msg) -> Maybe a -> List (H.Attribute msg) -> List (H.Attribute msg)
withMaybeAttribute toAttribute maybeValue attrs =
    Maybe.map (toAttribute >> (\attr -> attr :: attrs)) maybeValue
        |> Maybe.withDefault attrs


withHtmlAttributes : List ( String, String ) -> List (H.Attribute msg) -> List (H.Attribute msg)
withHtmlAttributes list attributes =
    List.map (\( a, b ) -> HA.attribute a b) list
        |> (++) attributes


fromString : (String -> Maybe a) -> Maybe a -> String -> Maybe a
fromString parse currentValue input =
    if String.isEmpty input then
        Nothing

    else
        parse input
            |> Maybe.map Just
            |> Maybe.withDefault currentValue
