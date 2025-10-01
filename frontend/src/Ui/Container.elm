module Ui.Container exposing (..)

import Html exposing (..)
import Html.Attributes exposing (..)


flat : List (Html.Attribute msg) -> List (Html msg) -> Html msg
flat attrs children =
    div
        (class "Container p-6" :: attrs)
        children


base : List (Html.Attribute msg) -> List (Html msg) -> Html msg
base attrs children =
    flat (class "Container-base bg-base-300/50 text-base-content" :: attrs) children


primary : List (Html.Attribute msg) -> List (Html msg) -> Html msg
primary attrs children =
    flat (class "Container-primary bg-primary text-primary-content" :: attrs) children


secondary : List (Html.Attribute msg) -> List (Html msg) -> Html msg
secondary attrs children =
    flat (class "Container-secondary bg-secondary text-secondary-content" :: attrs) children


accent : List (Html.Attribute msg) -> List (Html msg) -> Html msg
accent attrs children =
    flat (class "Container-accent bg-accent text-accent-content" :: attrs) children


info : List (Html.Attribute msg) -> List (Html msg) -> Html msg
info attrs children =
    flat (class "Container-info bg-info text-info-content" :: attrs) children


warning : List (Html.Attribute msg) -> List (Html msg) -> Html msg
warning attrs children =
    flat (class "Container-warning bg-warning text-warning-content" :: attrs) children


error : List (Html.Attribute msg) -> List (Html msg) -> Html msg
error attrs children =
    flat (class "Container-error bg-error text-error-content" :: attrs) children
