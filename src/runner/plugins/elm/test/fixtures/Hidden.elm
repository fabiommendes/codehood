module Hidden exposing (tests)

import Expect
import Main exposing (soma)
import Test exposing (Test, describe, test)


tests : Test
tests =
    describe "hidden"
        [ -- mdq: [+2] Soma listas longas
          test "longa" <| \_ -> Expect.equal 55 (soma (List.range 1 10))
        , -- mdq: [+1] Soma negativos
          test "negativos" <| \_ -> Expect.equal -3 (soma [ -1, -2 ])
        ]
