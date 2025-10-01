Frontend
========

> Built with [Elm Land](https://elm.land) 🌈


## Getting started with development

Prepare your IDE with Elm's development tools + NPM +
[uv](https://docs.astral.sh/uv/). If you use VSCode, type `ctrl + p` and then  
`ext install Elmtooling.elm-ls-vscode elm-land.elm-land`.

Start the development server with

    $ npm run dev

You need to start the API server

    $ npm run server

Or use [mprocs](https://github.com/pvolok/mprocs) to start both, if you have 
it installed.

    $ mprocs

The Elm compiler and LSP usually provides a very nice DX, however it has it share
of quirks and the LSP tend to get confused sometimes. If you run into issues,
try restarting the LSP server or your IDE and clean the build artifacts with

    $ npm run clean

All the previous commands assume a POSIX-like shell. If you are using Windows,
you might need to install
[WSL](https://docs.microsoft.com/en-us/windows/wsl/install) or use a compatible
terminal emulator.


## General architecture

The project is structured as a single Elm Land application. The main parts of
the application are:

* **Data** - the data structures that represent objects in the application. This
  is also where the Json decoders and encoders are defined. Each module module
  corresponds to a specific object/type, e.g., `Data.User` defines the
  `Data.User.User` type and define the correspoding JSON decoders as
  `Data.User.decoder` and encoder as `Data.User.encode`.
* **Api** - functions to interact with the backend API. Each section in the
  swagger documentation has a corresponding module here, e.g., `Api.Auth` has all
  routes related to authentication.
* **Ui** - simple UI elements like buttons, inputs, etc. that are used across
  different pages and components. Ui do not have their own Model and Msg types,
  and usully correspond to a single view function. 
* **Elements/Components** - reusable UI elements that can be used across
  different pages. They obbey a simple Elm architecture pattern with
  `Model`, `Msg` types. Components and Elements differ in the signature of the
  `init` and `update` functions:

  **Components**
  
  Uses the Browser.sandbox API

    * `init: params -> Model`
    * `update: Msg -> Model -> Model`

  **Elements**

  Uses the Browser.element API

   * `init: params -> (Model, Effect Msg)`
   * `update: Msg -> Model -> (Model, Effect Msg)`
   * `subscriptions: Model -> Sub Msg`
  
  Msg types are usually exported as Msg(..). However, message names ending with
  an underscore (_) are meant to be internal messages only and should not
  created or captured by users of the element/component.

  Components are favored to Elements. And usually if an UI element needs to
  interact with the backend API, it should be implemented as a Component used by
  a Page which is then responsible to manage the API interactions.
* **Pages** - the main views of the application, each page corresponds to a
  specific route. Usually pages implement the Api interactions and control the
  corresponding Element/Components passing the necessary messages.
* **Util** - utility functions that can be used across different parts of the
  application. 
* **Util.Lens** - define lenses to work with nested records. Lenses are defined
  here as the record: 
  
  ```elm
  type alias Lens big small =
      { get : big -> small
      , set : small -> big -> big
      }
  ```
  where `big` is the type of the record and `small` is the type of the field.
  Many field attributes have a corresponding lens defined here. They are
  organized alphabetically in the module and you can define new lenses as
  needed.

### Elm-land specific

* **Effect** - side effects that can be performed in the application.
  Effects are similar to Elm commands, but they can also represent other types
  of side effects like navigation, local storage, etc. See module documentation
  for more details.
* **Layout.Main** - the main layout of the application. This module is
  responsible for rendering the main structure of the application, including
  the header, footer, and main content area.


## Site structure

The Elm Land router is used to manage the site structure. Below are the main
public urls.

* **Home page:** `/`
* **Sign up page:** `/auth/register/`
* **Sign in page:** `/auth/login/`
* **List of courses per discipline:** `/<discipline>/`
* **Classroom page:** `/<discipline>/<instructor>-<edition>/`
* **User profile page:** `/u/<user-id>/`
* **User post page:** `/u/<user-id>/posts/<url>`
* **Account files page:** `/account/files/<urls>.../`
* /c/<course>/<teacher>

## Internal urls

* /system/styles/
* /system/stats/
* /playground/*temporary page*/

## Local development

```bash
# Requires Node.js v18+ (https://nodejs.org)
npx elm-land server
```

## Deploying to production

Elm Land projects are most commonly deployed as static websites. 

Please visit [the "Deployment" guide](https://elm.land/guide/deploying) to learn more
about deploying your app for free using Netlify or Vercel.