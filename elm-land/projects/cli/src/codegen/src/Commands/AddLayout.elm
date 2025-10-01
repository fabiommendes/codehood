module Commands.AddLayout exposing (run)

import CodeGen
import CodeGen.Annotation
import CodeGen.Argument
import CodeGen.Declaration
import CodeGen.Expression
import CodeGen.Import
import CodeGen.Module
import Json.Decode


run : Json.Decode.Value -> List CodeGen.Module
run json =
    case Json.Decode.decodeValue decoder json of
        Ok data ->
            [ newLayoutModule data ]

        Err _ ->
            []



-- DATA


type alias Data =
    { moduleSegments : List String
    }


decoder : Json.Decode.Decoder Data
decoder =
    Json.Decode.map Data
        (Json.Decode.field "moduleSegments" (Json.Decode.list Json.Decode.string))



-- CODEGEN


newLayoutModule : Data -> CodeGen.Module
newLayoutModule data =
    let
        {- Example:

           type alias Props =
               {}

        -}
        settingsTypeAlias : CodeGen.Declaration
        settingsTypeAlias =
            CodeGen.Declaration.typeAlias
                { name = "Props"
                , annotation = CodeGen.Annotation.record []
                }

        {- Example:

           layout : Props -> Shared.Model -> Route () -> Layout () Model Msg contentMsg
           layout props shared route =
               Layout.new
                   { init = init
                   , update = update
                   , view = view
                   , subscriptions = subscriptions
                   }

        -}
        layoutFunction : CodeGen.Declaration
        layoutFunction =
            CodeGen.Declaration.function
                { name = "layout"
                , annotation =
                    CodeGen.Annotation.type_
                        ("Props -> Shared.Model -> Route () -> Layout {{parentProps}} Model Msg contentMsg"
                            |> String.replace "{{parentProps}}"
                                (case parentLayoutModuleName of
                                    Just moduleName ->
                                        moduleName ++ ".Props"

                                    Nothing ->
                                        "()"
                                )
                        )
                , arguments =
                    [ CodeGen.Argument.new "props"
                    , CodeGen.Argument.new "shared"
                    , CodeGen.Argument.new "route"
                    ]
                , expression =
                    case parentLayoutModuleName of
                        Nothing ->
                            newLayoutExpression

                        Just moduleName ->
                            CodeGen.Expression.pipeline
                                [ newLayoutExpression
                                , CodeGen.Expression.function
                                    { name = "Layout.withParentProps"
                                    , arguments =
                                        [ CodeGen.Expression.parens
                                            [ "Debug.todo \"TODO: Add {{parentProps}}\""
                                                |> String.replace "{{parentProps}}" (moduleName ++ ".Props")
                                                |> CodeGen.Expression.value
                                            ]
                                        ]
                                    }
                                ]
                }

        newLayoutExpression =
            CodeGen.Expression.multilineFunction
                { name = "Layout.new"
                , arguments =
                    [ CodeGen.Expression.multilineRecord
                        [ ( "init", CodeGen.Expression.value "init" )
                        , ( "update", CodeGen.Expression.value "update" )
                        , ( "view", CodeGen.Expression.value "view" )
                        , ( "subscriptions", CodeGen.Expression.value "subscriptions" )
                        ]
                    ]
                }

        {- Example:

           type alias Model =
               {}

        -}
        modelTypeAlias : CodeGen.Declaration
        modelTypeAlias =
            CodeGen.Declaration.typeAlias
                { name = "Model"
                , annotation = CodeGen.Annotation.record []
                }

        {- Example:

           init : () -> ( Model, Effect Msg )
           init _ =
               ( {}
               , Effect.none
               )

        -}
        initFunction : CodeGen.Declaration
        initFunction =
            CodeGen.Declaration.function
                { name = "init"
                , annotation = CodeGen.Annotation.type_ "() -> ( Model, Effect Msg )"
                , arguments = [ CodeGen.Argument.new "_" ]
                , expression =
                    CodeGen.Expression.multilineTuple
                        [ CodeGen.Expression.record []
                        , CodeGen.Expression.value "Effect.none"
                        ]
                }

        {- Example:

           type Msg
               = ReplaceMe

        -}
        msgCustomType : CodeGen.Declaration
        msgCustomType =
            CodeGen.Declaration.customType
                { name = "Msg"
                , variants = [ ( "ReplaceMe", [] ) ]
                }

        {- Example:

           update : Msg -> Model -> ( Model, Effect Msg )
           update msg model =
               case msg of
                   ReplaceMe ->
                       ( model
                       , Effect.none
                       )

        -}
        updateFunction =
            CodeGen.Declaration.function
                { name = "update"
                , annotation = CodeGen.Annotation.type_ "Msg -> Model -> ( Model, Effect Msg )"
                , arguments = [ CodeGen.Argument.new "msg", CodeGen.Argument.new "model" ]
                , expression =
                    CodeGen.Expression.caseExpression
                        { value = CodeGen.Argument.new "msg"
                        , branches =
                            [ { name = "ReplaceMe"
                              , arguments = []
                              , expression =
                                    CodeGen.Expression.multilineTuple
                                        [ CodeGen.Expression.value "model"
                                        , CodeGen.Expression.value "Effect.none"
                                        ]
                              }
                            ]
                        }
                }

        {- Example:

           subscriptions : Model -> Sub Msg
           subscriptions model =
               Sub.none
        -}
        subscriptionsFunction =
            CodeGen.Declaration.function
                { name = "subscriptions"
                , annotation = CodeGen.Annotation.type_ "Model -> Sub Msg"
                , arguments = [ CodeGen.Argument.new "model" ]
                , expression = CodeGen.Expression.value "Sub.none"
                }

        {- Example:

           view :
               { toContentMsg : Msg -> contentMsg
               , content : View contentMsg
               , model : Model
               }
               -> View contentMsg
           view { toContentMsg, model, content } =
               { title = content.title
               , body =
                   [ Html.text "Header"
                   , Html.div [ class "page" ] content.body
                   ]
               }

        -}
        viewFunction =
            CodeGen.Declaration.function
                { name = "view"
                , annotation = CodeGen.Annotation.type_ "{ toContentMsg : Msg -> contentMsg, content : View contentMsg, model : Model } -> View contentMsg"
                , arguments = [ CodeGen.Argument.new "{ toContentMsg, model, content }" ]
                , expression =
                    CodeGen.Expression.multilineRecord
                        [ ( "title", CodeGen.Expression.value "content.title" )
                        , ( "body"
                          , CodeGen.Expression.multilineList
                                [ CodeGen.Expression.function
                                    { name = "Html.text "
                                    , arguments =
                                        [ CodeGen.Expression.string (String.join "." data.moduleSegments)
                                        ]
                                    }
                                , CodeGen.Expression.value "Html.div [ class \"page\" ] content.body"
                                ]
                          )
                        ]
                }

        parentLayoutModuleName : Maybe String
        parentLayoutModuleName =
            if List.length data.moduleSegments > 1 then
                data.moduleSegments
                    |> List.reverse
                    |> List.drop 1
                    |> List.reverse
                    |> String.join "."
                    |> (\str -> "Layouts." ++ str)
                    |> Just

            else
                Nothing
    in
    CodeGen.Module.new
        { name = "Layouts" :: data.moduleSegments
        , exposing_ = [ "Model", "Msg", "Props", "layout" ]
        , imports =
            [ CodeGen.Import.new [ "Effect" ]
                |> CodeGen.Import.withExposing [ "Effect" ]
            , CodeGen.Import.new [ "Html" ]
                |> CodeGen.Import.withExposing [ "Html" ]
            , CodeGen.Import.new [ "Html", "Attributes" ]
                |> CodeGen.Import.withExposing [ "class" ]
            , CodeGen.Import.new [ "Layout" ]
                |> CodeGen.Import.withExposing [ "Layout" ]
            , CodeGen.Import.new [ "Route" ]
                |> CodeGen.Import.withExposing [ "Route" ]
            , CodeGen.Import.new [ "Shared" ]
            , CodeGen.Import.new [ "View" ]
                |> CodeGen.Import.withExposing [ "View" ]
            ]
                ++ (case parentLayoutModuleName of
                        Just moduleName ->
                            [ CodeGen.Import.new (String.split "." moduleName) ]

                        Nothing ->
                            []
                   )
        , declarations =
            [ settingsTypeAlias
            , layoutFunction
            , CodeGen.Declaration.comment [ "MODEL" ]
            , modelTypeAlias
            , initFunction
            , CodeGen.Declaration.comment [ "UPDATE" ]
            , msgCustomType
            , updateFunction
            , subscriptionsFunction
            , CodeGen.Declaration.comment [ "VIEW" ]
            , viewFunction
            ]
        }
