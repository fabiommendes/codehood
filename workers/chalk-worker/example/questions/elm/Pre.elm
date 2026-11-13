module Pre exposing (tests)

import Expect
import Main exposing (soma)
import Test exposing (Test, describe, test)


-- mdq: [0] {public} Soma a lista vazia e um elemento
tests : Test
tests =
    describe "pre"
        [ test "vazia" <| \_ -> Expect.equal 0 (soma [])
        , test "um" <| \_ -> Expect.equal 7 (soma [ 7 ])
        ]
