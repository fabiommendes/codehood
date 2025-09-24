{
    "openapi": "3.1.1",
    "info": {
        "title": "mdq.models",
        "version": "1.0.0"
    },
    "components": {
        "schemas": {
            "AMultipleSelectionQuestion": {
                "description": "Multiple selection questions display a list of choices and a full grade is  given if the user computes all correct answers and none of the incorrect ones.",
                "properties": {
                    "id": {
                        "minLength": 1,
                        "title": "Id",
                        "type": "string"
                    },
                    "title": {
                        "anyOf": [
                            {
                                "minLength": 1,
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Title"
                    },
                    "type": {
                        "const": "multiple-selection",
                        "default": "multiple-selection",
                        "title": "Type",
                        "type": "string"
                    },
                    "format": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/TextFormat"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "md"
                    },
                    "comment": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Comment"
                    },
                    "epilogue": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Epilogue"
                    },
                    "footnotes": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/Footnote"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Footnotes"
                    },
                    "grade-range": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/GradeRange"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null
                    },
                    "media": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/MediaObject"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Media"
                    },
                    "preamble": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Preamble"
                    },
                    "stem": {
                        "examples": [
                            "Select the correct answer.",
                            "How much is 2 + 2?",
                            "The capital of France is..."
                        ],
                        "minLength": 1,
                        "title": "Stem",
                        "type": "string"
                    },
                    "tags": {
                        "anyOf": [
                            {
                                "items": {
                                    "type": "string"
                                },
                                "type": "array",
                                "uniqueItems": true
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "title": "Tags"
                    },
                    "weight": {
                        "anyOf": [
                            {
                                "type": "number"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": 100,
                        "title": "Weight"
                    },
                    "shuffle": {
                        "anyOf": [
                            {
                                "type": "boolean"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": true,
                        "title": "Shuffle"
                    },
                    "choices": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/Choice"
                                },
                                "minItems": 2,
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Choices"
                    },
                    "grading": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/Grading"
                            },
                            {
                                "type": "null"
                            }
                        ]
                    }
                },
                "required": [
                    "id",
                    "stem",
                    "tags",
                    "grading"
                ],
                "title": "AMultipleSelectionQuestion",
                "type": "object"
            },
            "ArtifactType": {
                "description": "The type of artifact produced by the compilation. It is used to determine how to execute the code.",
                "enum": [
                    "lib",
                    "executable"
                ],
                "title": "ArtifactType",
                "type": "string"
            },
            "AssociativeItemImage": {
                "properties": {
                    "alt": {
                        "title": "Alt",
                        "type": "string"
                    },
                    "url": {
                        "title": "Url",
                        "type": "string"
                    }
                },
                "required": [
                    "alt",
                    "url"
                ],
                "title": "AssociativeItemImage",
                "type": "object"
            },
            "AssociativeItemKeyImage": {
                "properties": {
                    "alt": {
                        "title": "Alt",
                        "type": "string"
                    },
                    "url": {
                        "title": "Url",
                        "type": "string"
                    },
                    "answer-key": {
                        "items": {
                            "type": "string"
                        },
                        "minItems": 1,
                        "title": "Answer-Key",
                        "type": "array",
                        "uniqueItems": true
                    },
                    "feedback": {
                        "anyOf": [
                            {
                                "additionalProperties": {
                                    "type": "string"
                                },
                                "type": "object"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": {},
                        "title": "Feedback"
                    }
                },
                "required": [
                    "alt",
                    "url",
                    "answer-key"
                ],
                "title": "AssociativeItemKeyImage",
                "type": "object"
            },
            "AssociativeItemKeyText": {
                "properties": {
                    "style": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "simple",
                        "title": "Style"
                    },
                    "text": {
                        "title": "Text",
                        "type": "string"
                    },
                    "answer-key": {
                        "items": {
                            "type": "string"
                        },
                        "minItems": 1,
                        "title": "Answer-Key",
                        "type": "array",
                        "uniqueItems": true
                    },
                    "feedback": {
                        "anyOf": [
                            {
                                "additionalProperties": {
                                    "type": "string"
                                },
                                "type": "object"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": {},
                        "title": "Feedback"
                    }
                },
                "required": [
                    "text",
                    "answer-key"
                ],
                "title": "AssociativeItemKeyText",
                "type": "object"
            },
            "AssociativeItemText": {
                "properties": {
                    "style": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "simple",
                        "title": "Style"
                    },
                    "text": {
                        "title": "Text",
                        "type": "string"
                    }
                },
                "required": [
                    "text"
                ],
                "title": "AssociativeItemText",
                "type": "object"
            },
            "AssociativeQuestion": {
                "description": "Associative questions display a list of items and the user must associate each item with their corresponding answer.",
                "properties": {
                    "id": {
                        "minLength": 1,
                        "title": "Id",
                        "type": "string"
                    },
                    "title": {
                        "anyOf": [
                            {
                                "minLength": 1,
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Title"
                    },
                    "type": {
                        "const": "associative",
                        "default": "associative",
                        "title": "Type",
                        "type": "string"
                    },
                    "format": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/TextFormat"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "md"
                    },
                    "comment": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Comment"
                    },
                    "epilogue": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Epilogue"
                    },
                    "footnotes": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/Footnote"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Footnotes"
                    },
                    "grade-range": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/GradeRange"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null
                    },
                    "media": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/MediaObject"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Media"
                    },
                    "preamble": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Preamble"
                    },
                    "stem": {
                        "examples": [
                            "Select the correct answer.",
                            "How much is 2 + 2?",
                            "The capital of France is..."
                        ],
                        "minLength": 1,
                        "title": "Stem",
                        "type": "string"
                    },
                    "tags": {
                        "anyOf": [
                            {
                                "items": {
                                    "type": "string"
                                },
                                "type": "array",
                                "uniqueItems": true
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "title": "Tags"
                    },
                    "weight": {
                        "anyOf": [
                            {
                                "type": "number"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": 100,
                        "title": "Weight"
                    },
                    "shuffle": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/Shuffle"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "both"
                    },
                    "keys": {
                        "anyOf": [
                            {
                                "items": {
                                    "anyOf": [
                                        {
                                            "$ref": "#/components/schemas/AssociativeItemKeyText"
                                        },
                                        {
                                            "$ref": "#/components/schemas/AssociativeItemKeyImage"
                                        }
                                    ]
                                },
                                "minItems": 1,
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Keys"
                    },
                    "values": {
                        "anyOf": [
                            {
                                "additionalProperties": {
                                    "anyOf": [
                                        {
                                            "$ref": "#/components/schemas/AssociativeItemText"
                                        },
                                        {
                                            "$ref": "#/components/schemas/AssociativeItemImage"
                                        }
                                    ]
                                },
                                "type": "object"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "title": "Values"
                    }
                },
                "required": [
                    "id",
                    "stem",
                    "tags",
                    "values"
                ],
                "title": "AssociativeQuestion",
                "type": "object"
            },
            "Choice": {
                "properties": {
                    "feedback": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Feedback"
                    },
                    "fixed": {
                        "anyOf": [
                            {
                                "type": "boolean"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": false,
                        "title": "Fixed"
                    },
                    "text": {
                        "minLength": 1,
                        "title": "Text",
                        "type": "string"
                    },
                    "correct": {
                        "anyOf": [
                            {
                                "type": "boolean"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": false,
                        "title": "Correct"
                    }
                },
                "required": [
                    "text"
                ],
                "title": "Choice",
                "type": "object"
            },
            "CodeIoConf": {
                "description": "A dictionary with configuration options for how the student submissions will be matched with the answer key.",
                "properties": {
                    "case-sensitive": {
                        "anyOf": [
                            {
                                "type": "boolean"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": true,
                        "title": "Case-Sensitive"
                    },
                    "ignore-accents": {
                        "anyOf": [
                            {
                                "type": "boolean"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": false,
                        "title": "Ignore-Accents"
                    },
                    "match-spaces": {
                        "anyOf": [
                            {
                                "type": "boolean"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": false,
                        "title": "Match-Spaces"
                    }
                },
                "title": "CodeIoConf",
                "type": "object"
            },
            "CodingIOQuestion": {
                "description": "A programming question that evaluates the result using by passing specific text inputs and  comparing it with the expected outputs displayed on the terminal.",
                "properties": {
                    "id": {
                        "minLength": 1,
                        "title": "Id",
                        "type": "string"
                    },
                    "title": {
                        "anyOf": [
                            {
                                "minLength": 1,
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Title"
                    },
                    "type": {
                        "const": "code-io",
                        "default": "code-io",
                        "title": "Type",
                        "type": "string"
                    },
                    "format": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/TextFormat"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "md"
                    },
                    "comment": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Comment"
                    },
                    "epilogue": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Epilogue"
                    },
                    "footnotes": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/Footnote"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Footnotes"
                    },
                    "grade-range": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/GradeRange"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null
                    },
                    "media": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/MediaObject"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Media"
                    },
                    "preamble": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Preamble"
                    },
                    "stem": {
                        "examples": [
                            "Select the correct answer.",
                            "How much is 2 + 2?",
                            "The capital of France is..."
                        ],
                        "minLength": 1,
                        "title": "Stem",
                        "type": "string"
                    },
                    "tags": {
                        "anyOf": [
                            {
                                "items": {
                                    "type": "string"
                                },
                                "type": "array",
                                "uniqueItems": true
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "title": "Tags"
                    },
                    "weight": {
                        "anyOf": [
                            {
                                "type": "number"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": 100,
                        "title": "Weight"
                    },
                    "answer-key": {
                        "anyOf": [
                            {
                                "items": {
                                    "anyOf": [
                                        {
                                            "$ref": "#/components/schemas/IoAnswerKey"
                                        },
                                        {
                                            "$ref": "#/components/schemas/IospecAnswerKey"
                                        }
                                    ]
                                },
                                "minItems": 1,
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Answer-Key"
                    },
                    "compilation": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/Compilation"
                            },
                            {
                                "type": "null"
                            }
                        ]
                    },
                    "environment": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/Environment"
                            },
                            {
                                "type": "null"
                            }
                        ]
                    },
                    "forbidden-functions": {
                        "anyOf": [
                            {
                                "additionalProperties": {
                                    "items": {
                                        "type": "string"
                                    },
                                    "type": "array"
                                },
                                "type": "object"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Forbidden-Functions"
                    },
                    "forbidden-modules": {
                        "anyOf": [
                            {
                                "additionalProperties": {
                                    "items": {
                                        "type": "string"
                                    },
                                    "type": "array"
                                },
                                "type": "object"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Forbidden-Modules"
                    },
                    "forbidden-syntax": {
                        "anyOf": [
                            {
                                "additionalProperties": {
                                    "additionalProperties": {
                                        "type": "integer"
                                    },
                                    "type": "object"
                                },
                                "type": "object"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": {},
                        "examples": [
                            {
                                "": {
                                    "for": 1,
                                    "if": 2,
                                    "while": 0
                                },
                                "cpp": {
                                    "for": 2,
                                    "if": 3
                                }
                            }
                        ],
                        "title": "Forbidden-Syntax"
                    },
                    "forbidden-types": {
                        "anyOf": [
                            {
                                "additionalProperties": {
                                    "items": {
                                        "type": "string"
                                    },
                                    "type": "array"
                                },
                                "type": "object"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Forbidden-Types"
                    },
                    "linting": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/Linting"
                            },
                            {
                                "type": "null"
                            }
                        ]
                    },
                    "placeholder": {
                        "anyOf": [
                            {
                                "additionalProperties": true,
                                "type": "object"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "examples": [
                            {
                                "python": "def main():\n    x = ... # your code here\n    print(\"x =\", x)\n"
                            }
                        ],
                        "title": "Placeholder"
                    },
                    "supported-languages": {
                        "anyOf": [
                            {
                                "items": {
                                    "type": "string"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Supported-Languages"
                    },
                    "timeout": {
                        "anyOf": [
                            {},
                            {
                                "type": "number"
                            },
                            {
                                "$ref": "#/components/schemas/Timeout"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "title": "Timeout"
                    },
                    "conf": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/CodeIoConf"
                            },
                            {
                                "type": "null"
                            }
                        ]
                    }
                },
                "required": [
                    "id",
                    "stem",
                    "tags",
                    "compilation",
                    "environment",
                    "linting",
                    "timeout",
                    "conf"
                ],
                "title": "CodingIOQuestion",
                "type": "object"
            },
            "Compilation": {
                "description": "A dictionary mapping programming languages with their corresponding compilation environments. The options vary on a per-language basis and are encoded as somewhat arbitrary JSON objects.",
                "properties": {
                    "type": {
                        "anyOf": [
                            {
                                "minLength": 1,
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Type"
                    },
                    "artifact": {
                        "anyOf": [
                            {
                                "minLength": 1,
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Artifact"
                    },
                    "artifact-type": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/ArtifactType"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "executable"
                    }
                },
                "title": "Compilation",
                "type": "object"
            },
            "Environment": {
                "description": "A dictionary mapping programming languages with their corresponding execution environment. The options vary on a per-language basis and are encoded as arbitrary JSON objects with a required \"type\" key. Each language is associated with a single environment. It is up to the execution environment interpret how the environment options affect how code is  executed.",
                "properties": {
                    "type": {
                        "anyOf": [
                            {
                                "minLength": 1,
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Type"
                    }
                },
                "title": "Environment",
                "type": "object"
            },
            "FillInInputNumeric": {
                "description": "Used for numeric inputs. The answer is a number and the grading is done by comparing the answer with the correct answer within a tolerance.",
                "properties": {
                    "type": {
                        "const": "numeric",
                        "default": "numeric",
                        "title": "Type",
                        "type": "string"
                    },
                    "answer-key": {
                        "title": "Answer-Key",
                        "type": "number"
                    },
                    "relative-tol": {
                        "anyOf": [
                            {},
                            {
                                "type": "null"
                            }
                        ],
                        "default": 0,
                        "title": "Relative-Tol"
                    },
                    "tol": {
                        "anyOf": [
                            {},
                            {
                                "type": "null"
                            }
                        ],
                        "default": 0,
                        "title": "Tol"
                    },
                    "unit": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "examples": [
                            "m",
                            "kg",
                            "s",
                            "meters"
                        ],
                        "title": "Unit"
                    }
                },
                "required": [
                    "answer-key"
                ],
                "title": "FillInInputNumeric",
                "type": "object"
            },
            "FillInInputSelection": {
                "description": "It is used to display a selection box with a list of choices.",
                "properties": {
                    "type": {
                        "const": "selection",
                        "default": "selection",
                        "title": "Type",
                        "type": "string"
                    },
                    "choices": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/MultipleChoiceItem"
                                },
                                "minItems": 2,
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Choices"
                    }
                },
                "title": "FillInInputSelection",
                "type": "object"
            },
            "FillInInputText": {
                "description": "Used for text based inputs. The answer is a short string of text and the grading is done by comparing it with the reference answer key. For longer answers, please use the \"essay\"  question type.",
                "properties": {
                    "type": {
                        "const": "text",
                        "default": "text",
                        "title": "Type",
                        "type": "string"
                    },
                    "answer-key": {
                        "title": "Answer-Key",
                        "type": "string"
                    },
                    "case-sensitive": {
                        "anyOf": [
                            {
                                "type": "boolean"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": false,
                        "title": "Case-Sensitive"
                    }
                },
                "required": [
                    "answer-key"
                ],
                "title": "FillInInputText",
                "type": "object"
            },
            "FillInTheBlankQuestion": {
                "description": "Fill-in-the-blank questions display a paragraph of text intercalated with input fields to representing blanks the user must fill in. The blanks can be of several different types.",
                "properties": {
                    "id": {
                        "minLength": 1,
                        "title": "Id",
                        "type": "string"
                    },
                    "title": {
                        "anyOf": [
                            {
                                "minLength": 1,
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Title"
                    },
                    "type": {
                        "title": "Type",
                        "type": "string"
                    },
                    "format": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/TextFormat"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "md"
                    },
                    "comment": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Comment"
                    },
                    "epilogue": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Epilogue"
                    },
                    "footnotes": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/Footnote"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Footnotes"
                    },
                    "grade-range": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/GradeRange"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null
                    },
                    "media": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/MediaObject"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Media"
                    },
                    "preamble": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Preamble"
                    },
                    "stem": {
                        "examples": [
                            "Select the correct answer.",
                            "How much is 2 + 2?",
                            "The capital of France is..."
                        ],
                        "minLength": 1,
                        "title": "Stem",
                        "type": "string"
                    },
                    "tags": {
                        "anyOf": [
                            {
                                "items": {
                                    "type": "string"
                                },
                                "type": "array",
                                "uniqueItems": true
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "title": "Tags"
                    },
                    "weight": {
                        "anyOf": [
                            {
                                "type": "number"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": 100,
                        "title": "Weight"
                    },
                    "body": {
                        "items": {
                            "anyOf": [
                                {
                                    "$ref": "#/components/schemas/FillInInputSelection"
                                },
                                {
                                    "$ref": "#/components/schemas/FillInInputNumeric"
                                },
                                {
                                    "$ref": "#/components/schemas/FillInInputText"
                                }
                            ]
                        },
                        "minItems": 1,
                        "title": "Body",
                        "type": "array"
                    }
                },
                "required": [
                    "id",
                    "type",
                    "stem",
                    "tags",
                    "body"
                ],
                "title": "FillInTheBlankQuestion",
                "type": "object"
            },
            "Footnote": {
                "description": "A footnote is a reference to a note at the bottom of the page. It is used to provide  additional information about a word or phrase in the text. They can be referenced in the preamble, epilogue or in the main text of the question.",
                "properties": {
                    "id": {
                        "minLength": 1,
                        "title": "Id",
                        "type": "string"
                    },
                    "text": {
                        "minLength": 1,
                        "title": "Text",
                        "type": "string"
                    }
                },
                "required": [
                    "id",
                    "text"
                ],
                "title": "Footnote",
                "type": "object"
            },
            "GradeRange": {
                "description": "Describes how the question should be graded. Usually grades are represented as a percentage between 0 and 100. In order to award different points to different questions, use the weight field instead of tweaking this field.",
                "properties": {
                    "max": {
                        "anyOf": [
                            {
                                "type": "number"
                            },
                            {},
                            {
                                "type": "null"
                            }
                        ],
                        "default": 100,
                        "title": "Max"
                    },
                    "min": {
                        "anyOf": [
                            {
                                "type": "number"
                            },
                            {},
                            {
                                "type": "null"
                            }
                        ],
                        "default": 0,
                        "title": "Min"
                    }
                },
                "title": "GradeRange",
                "type": "object"
            },
            "Grading": {
                "description": "How should the question be graded?",
                "properties": {
                    "strategy": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "strict",
                        "title": "Strategy"
                    }
                },
                "title": "Grading",
                "type": "object"
            },
            "Grading1": {
                "description": "How the question should be graded?",
                "properties": {
                    "strategy": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/TrueFalseGradingStrategy"
                            },
                            {
                                "type": "null"
                            }
                        ]
                    }
                },
                "required": [
                    "strategy"
                ],
                "title": "Grading1",
                "type": "object"
            },
            "IoAnswerKey": {
                "properties": {
                    "input": {
                        "title": "Input",
                        "type": "string"
                    },
                    "output": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "title": "Output"
                    }
                },
                "required": [
                    "input",
                    "output"
                ],
                "title": "IoAnswerKey",
                "type": "object"
            },
            "IospecAnswerKey": {
                "properties": {
                    "iospec": {
                        "title": "Iospec",
                        "type": "string"
                    }
                },
                "required": [
                    "iospec"
                ],
                "title": "IospecAnswerKey",
                "type": "object"
            },
            "Linting": {
                "description": "A dictionary mapping programming languages with their corresponding linting options. Linting is executed on successful submissions and can discount points for style and poor practices.",
                "properties": {
                    "type": {
                        "anyOf": [
                            {
                                "minLength": 1,
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Type"
                    }
                },
                "title": "Linting",
                "type": "object"
            },
            "MediaObject": {
                "description": "A media object like an image or a video that can be referenced in the question.",
                "properties": {
                    "id": {
                        "minLength": 1,
                        "title": "Id",
                        "type": "string"
                    },
                    "type": {
                        "$ref": "#/components/schemas/MediaType"
                    },
                    "caption": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Caption"
                    },
                    "url": {
                        "minLength": 1,
                        "title": "Url",
                        "type": "string"
                    }
                },
                "required": [
                    "id",
                    "type",
                    "url"
                ],
                "title": "MediaObject",
                "type": "object"
            },
            "MediaType": {
                "description": "The type of media asset.",
                "enum": [
                    "image",
                    "video",
                    "audio"
                ],
                "title": "MediaType",
                "type": "string"
            },
            "MultipleChoiceGradingStrategy": {
                "description": "Describes how grades are computed from answers. Some strategies allow for multiple selections.\n* simple: \n    Student select a single choice, grade is assigned base on the \"value\" of the selected choice.\n* required:\n    Like before, but the student must select a choice. If no choice is selected, the question \n    receives an explicit penalty.\n* average:\n    Student can select multiple choices. The grade is the average of the selected choices.",
                "enum": [
                    "simple",
                    "required",
                    "average"
                ],
                "title": "MultipleChoiceGradingStrategy",
                "type": "string"
            },
            "MultipleChoiceItem": {
                "description": "A choice for the multiple choices question. It is a text with an optional feedback.",
                "properties": {
                    "feedback": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Feedback"
                    },
                    "fixed": {
                        "anyOf": [
                            {
                                "type": "boolean"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": false,
                        "title": "Fixed"
                    },
                    "text": {
                        "minLength": 1,
                        "title": "Text",
                        "type": "string"
                    },
                    "grade": {
                        "anyOf": [
                            {
                                "type": "number"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "title": "Grade"
                    }
                },
                "required": [
                    "text",
                    "grade"
                ],
                "title": "MultipleChoiceItem",
                "type": "object"
            },
            "MultipleChoiceQuestion": {
                "description": "Multiple choice questions accept a single correct answer, which yields full grade.",
                "properties": {
                    "id": {
                        "minLength": 1,
                        "title": "Id",
                        "type": "string"
                    },
                    "title": {
                        "anyOf": [
                            {
                                "minLength": 1,
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Title"
                    },
                    "type": {
                        "const": "multiple-choice",
                        "default": "multiple-choice",
                        "title": "Type",
                        "type": "string"
                    },
                    "format": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/TextFormat"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "md"
                    },
                    "comment": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Comment"
                    },
                    "epilogue": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Epilogue"
                    },
                    "footnotes": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/Footnote"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Footnotes"
                    },
                    "grade-range": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/GradeRange"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null
                    },
                    "media": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/MediaObject"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Media"
                    },
                    "preamble": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Preamble"
                    },
                    "stem": {
                        "examples": [
                            "Select the correct answer.",
                            "How much is 2 + 2?",
                            "The capital of France is..."
                        ],
                        "minLength": 1,
                        "title": "Stem",
                        "type": "string"
                    },
                    "tags": {
                        "anyOf": [
                            {
                                "items": {
                                    "type": "string"
                                },
                                "type": "array",
                                "uniqueItems": true
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "title": "Tags"
                    },
                    "weight": {
                        "anyOf": [
                            {
                                "type": "number"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": 100,
                        "title": "Weight"
                    },
                    "shuffle": {
                        "anyOf": [
                            {
                                "type": "boolean"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": true,
                        "title": "Shuffle"
                    },
                    "choices": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/MultipleChoiceItem"
                                },
                                "minItems": 2,
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Choices"
                    },
                    "grading-strategy": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/MultipleChoiceGradingStrategy"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null
                    },
                    "penalty": {
                        "anyOf": [
                            {
                                "type": "number"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": 0,
                        "title": "Penalty"
                    }
                },
                "required": [
                    "id",
                    "stem",
                    "tags"
                ],
                "title": "MultipleChoiceQuestion",
                "type": "object"
            },
            "OpenEndedEssay": {
                "description": "Essay questions display a text box where the user can write a long answer. The answer is graded manually.",
                "properties": {
                    "id": {
                        "minLength": 1,
                        "title": "Id",
                        "type": "string"
                    },
                    "title": {
                        "anyOf": [
                            {
                                "minLength": 1,
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Title"
                    },
                    "type": {
                        "const": "essay",
                        "default": "essay",
                        "title": "Type",
                        "type": "string"
                    },
                    "format": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/TextFormat"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "md"
                    },
                    "comment": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Comment"
                    },
                    "epilogue": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Epilogue"
                    },
                    "footnotes": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/Footnote"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Footnotes"
                    },
                    "grade-range": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/GradeRange"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null
                    },
                    "media": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/MediaObject"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Media"
                    },
                    "preamble": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Preamble"
                    },
                    "stem": {
                        "examples": [
                            "Select the correct answer.",
                            "How much is 2 + 2?",
                            "The capital of France is..."
                        ],
                        "minLength": 1,
                        "title": "Stem",
                        "type": "string"
                    },
                    "tags": {
                        "anyOf": [
                            {
                                "items": {
                                    "type": "string"
                                },
                                "type": "array",
                                "uniqueItems": true
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "title": "Tags"
                    },
                    "weight": {
                        "anyOf": [
                            {
                                "type": "number"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": 100,
                        "title": "Weight"
                    },
                    "shuffle": {
                        "anyOf": [
                            {
                                "type": "boolean"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": true,
                        "title": "Shuffle"
                    },
                    "input": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "richtext",
                        "examples": [
                            "text",
                            "richtext",
                            "python"
                        ],
                        "title": "Input"
                    }
                },
                "required": [
                    "id",
                    "stem",
                    "tags"
                ],
                "title": "OpenEndedEssay",
                "type": "object"
            },
            "Shuffle": {
                "description": "Whether it is possible to shuffle the order of the items in the association.",
                "enum": [
                    "both",
                    "keys",
                    "values",
                    "none"
                ],
                "title": "Shuffle",
                "type": "string"
            },
            "TextFormat": {
                "description": "How to interpret textual strings.",
                "enum": [
                    "md",
                    "text"
                ],
                "title": "TextFormat",
                "type": "string"
            },
            "Timeout": {
                "pattern": "[0-9]+(.[0-9]+)?%",
                "title": "Timeout",
                "type": "string"
            },
            "TrueFalseGradingStrategy": {
                "description": "A grading strategy for true-false questions. Points are awarded in the 0-100 range.",
                "properties": {
                    "correct": {
                        "anyOf": [
                            {
                                "type": "number"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": 100,
                        "title": "Correct"
                    },
                    "incorrect": {
                        "anyOf": [
                            {
                                "type": "number"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": 0,
                        "title": "Incorrect"
                    }
                },
                "title": "TrueFalseGradingStrategy",
                "type": "object"
            },
            "TrueFalseItem": {
                "description": "A choice for the true-false question. It is a text with an optional feedback.",
                "properties": {
                    "feedback": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Feedback"
                    },
                    "fixed": {
                        "anyOf": [
                            {
                                "type": "boolean"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": false,
                        "title": "Fixed"
                    },
                    "text": {
                        "minLength": 1,
                        "title": "Text",
                        "type": "string"
                    },
                    "correct": {
                        "anyOf": [
                            {
                                "type": "boolean"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "title": "Correct"
                    }
                },
                "required": [
                    "text",
                    "correct"
                ],
                "title": "TrueFalseItem",
                "type": "object"
            },
            "TrueFalseQuestion": {
                "description": "True-false questions display a list of choices in which the student should judge individually whether each one is true or false.",
                "properties": {
                    "id": {
                        "minLength": 1,
                        "title": "Id",
                        "type": "string"
                    },
                    "title": {
                        "anyOf": [
                            {
                                "minLength": 1,
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Title"
                    },
                    "type": {
                        "const": "true-false",
                        "default": "true-false",
                        "title": "Type",
                        "type": "string"
                    },
                    "format": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/TextFormat"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "md"
                    },
                    "comment": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Comment"
                    },
                    "epilogue": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Epilogue"
                    },
                    "footnotes": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/Footnote"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Footnotes"
                    },
                    "grade-range": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/GradeRange"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null
                    },
                    "media": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/MediaObject"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Media"
                    },
                    "preamble": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Preamble"
                    },
                    "stem": {
                        "examples": [
                            "Select the correct answer.",
                            "How much is 2 + 2?",
                            "The capital of France is..."
                        ],
                        "minLength": 1,
                        "title": "Stem",
                        "type": "string"
                    },
                    "tags": {
                        "anyOf": [
                            {
                                "items": {
                                    "type": "string"
                                },
                                "type": "array",
                                "uniqueItems": true
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "title": "Tags"
                    },
                    "weight": {
                        "anyOf": [
                            {
                                "type": "number"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": 100,
                        "title": "Weight"
                    },
                    "shuffle": {
                        "anyOf": [
                            {
                                "type": "boolean"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": true,
                        "title": "Shuffle"
                    },
                    "choices": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/TrueFalseItem"
                                },
                                "minItems": 1,
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Choices"
                    },
                    "grading": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/Grading1"
                            },
                            {
                                "type": "null"
                            }
                        ]
                    }
                },
                "required": [
                    "id",
                    "stem",
                    "tags",
                    "grading"
                ],
                "title": "TrueFalseQuestion",
                "type": "object"
            },
            "UnitTestQuestion": {
                "additionalProperties": false,
                "description": "A programming question that is evaluated running some unit tests.",
                "properties": {
                    "id": {
                        "minLength": 1,
                        "title": "Id",
                        "type": "string"
                    },
                    "title": {
                        "anyOf": [
                            {
                                "minLength": 1,
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Title"
                    },
                    "type": {
                        "const": "code-io",
                        "default": "code-io",
                        "title": "Type",
                        "type": "string"
                    },
                    "format": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/TextFormat"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "md"
                    },
                    "comment": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Comment"
                    },
                    "epilogue": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Epilogue"
                    },
                    "footnotes": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/Footnote"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Footnotes"
                    },
                    "grade-range": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/GradeRange"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null
                    },
                    "media": {
                        "anyOf": [
                            {
                                "items": {
                                    "$ref": "#/components/schemas/MediaObject"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Media"
                    },
                    "preamble": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Preamble"
                    },
                    "stem": {
                        "examples": [
                            "Select the correct answer.",
                            "How much is 2 + 2?",
                            "The capital of France is..."
                        ],
                        "minLength": 1,
                        "title": "Stem",
                        "type": "string"
                    },
                    "tags": {
                        "anyOf": [
                            {
                                "items": {
                                    "type": "string"
                                },
                                "type": "array",
                                "uniqueItems": true
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "title": "Tags"
                    },
                    "weight": {
                        "anyOf": [
                            {
                                "type": "number"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": 100,
                        "title": "Weight"
                    },
                    "answer-key": {
                        "anyOf": [
                            {
                                "additionalProperties": true,
                                "type": "object"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Answer-Key"
                    },
                    "compilation": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/Compilation"
                            },
                            {
                                "type": "null"
                            }
                        ]
                    },
                    "environment": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/Environment"
                            },
                            {
                                "type": "null"
                            }
                        ]
                    },
                    "forbidden-functions": {
                        "anyOf": [
                            {
                                "additionalProperties": {
                                    "items": {
                                        "type": "string"
                                    },
                                    "type": "array"
                                },
                                "type": "object"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Forbidden-Functions"
                    },
                    "forbidden-modules": {
                        "anyOf": [
                            {
                                "additionalProperties": {
                                    "items": {
                                        "type": "string"
                                    },
                                    "type": "array"
                                },
                                "type": "object"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Forbidden-Modules"
                    },
                    "forbidden-syntax": {
                        "anyOf": [
                            {
                                "additionalProperties": {
                                    "additionalProperties": {
                                        "type": "integer"
                                    },
                                    "type": "object"
                                },
                                "type": "object"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": {},
                        "examples": [
                            {
                                "": {
                                    "for": 1,
                                    "if": 2,
                                    "while": 0
                                },
                                "cpp": {
                                    "for": 2,
                                    "if": 3
                                }
                            }
                        ],
                        "title": "Forbidden-Syntax"
                    },
                    "forbidden-types": {
                        "anyOf": [
                            {
                                "additionalProperties": {
                                    "items": {
                                        "type": "string"
                                    },
                                    "type": "array"
                                },
                                "type": "object"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "title": "Forbidden-Types"
                    },
                    "linting": {
                        "anyOf": [
                            {
                                "$ref": "#/components/schemas/Linting"
                            },
                            {
                                "type": "null"
                            }
                        ]
                    },
                    "placeholder": {
                        "anyOf": [
                            {
                                "additionalProperties": true,
                                "type": "object"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": null,
                        "examples": [
                            {
                                "python": "def main():\n    x = ... # your code here\n    print(\"x =\", x)\n"
                            }
                        ],
                        "title": "Placeholder"
                    },
                    "supported-languages": {
                        "anyOf": [
                            {
                                "items": {
                                    "type": "string"
                                },
                                "type": "array"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Supported-Languages"
                    },
                    "timeout": {
                        "anyOf": [
                            {},
                            {
                                "type": "number"
                            },
                            {
                                "$ref": "#/components/schemas/Timeout"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "title": "Timeout"
                    }
                },
                "required": [
                    "id",
                    "stem",
                    "tags",
                    "compilation",
                    "environment",
                    "linting",
                    "timeout"
                ],
                "title": "UnitTestQuestion",
                "type": "object"
            },
            "Exam": {
                "additionalProperties": false,
                "description": "A MDQ Exam represents a document with a sequence of questions.",
                "properties": {
                    "id": {
                        "minLength": 1,
                        "title": "Id",
                        "type": "string"
                    },
                    "title": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Title"
                    },
                    "description": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Description"
                    },
                    "preamble": {
                        "anyOf": [
                            {
                                "type": "string"
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": "",
                        "title": "Preamble"
                    },
                    "questions": {
                        "items": {
                            "anyOf": [
                                {
                                    "$ref": "#/components/schemas/OpenEndedEssay"
                                },
                                {
                                    "$ref": "#/components/schemas/AssociativeQuestion"
                                },
                                {
                                    "$ref": "#/components/schemas/FillInTheBlankQuestion"
                                },
                                {
                                    "$ref": "#/components/schemas/MultipleChoiceQuestion"
                                },
                                {
                                    "$ref": "#/components/schemas/AMultipleSelectionQuestion"
                                },
                                {
                                    "$ref": "#/components/schemas/TrueFalseQuestion"
                                },
                                {
                                    "$ref": "#/components/schemas/CodingIOQuestion"
                                },
                                {
                                    "$ref": "#/components/schemas/UnitTestQuestion"
                                }
                            ]
                        },
                        "minItems": 1,
                        "title": "Questions",
                        "type": "array"
                    },
                    "tags": {
                        "anyOf": [
                            {
                                "items": {
                                    "type": "string"
                                },
                                "type": "array",
                                "uniqueItems": true
                            },
                            {
                                "type": "null"
                            }
                        ],
                        "default": [],
                        "title": "Tags"
                    }
                },
                "required": [
                    "id",
                    "questions"
                ],
                "title": "Exam",
                "type": "object"
            }
        }
    }
}