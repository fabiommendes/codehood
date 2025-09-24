import "./main.css";
import * as TaskPort from "elm-taskport";
import * as LocalStorage from "elm-localstorage";


TaskPort.install();
TaskPort.register("hello", x => "Hello " + x + "!");
LocalStorage.install(TaskPort);


export const flags = ({ env }) => {
    let flags = {
        credentials: JSON.parse(window.localStorage.credentials || "null"),
        classrooms: JSON.parse(window.localStorage.classrooms || "null"),
        api: "http://localhost:8000/api/v1"
    };
    console.log(flags.credentials);
    return flags;
}


export const onReady = ({ env, app }) => {
    if (app.ports) {
        // port sendToLocalStorage : { key : String, value : E.Value } -> Cmd msg
        app.ports.sendToLocalStorage.subscribe(({ key, value }) => {
            window.localStorage[key] = JSON.stringify(value)
        })

        // port sendToLogger: { level: String, title : String, data : E.Value } -> Cmd msg
        app.ports.sendToLogger.subscribe(({ level, title, data }) => {
            console.log(level + ": " + title);
            console.log(data);
        })

        //port sendToLayout: E.Value -> Cmd msg
        //port layoutMessages: (E.Value -> msg) -> Sub msg
        app.ports.sendToLayout.subscribe((value) => {
            console.log(value);
            app.ports.layoutMessages.send(value);
        })
    }
}


const registerServiceWorker = async () => {
    if ("serviceWorker" in navigator) {
        try {
            const registration = await navigator.serviceWorker.register("/static/sw.js", {
                scope: "/",
            });

            navigator.serviceWorker.onmessage = function (evt) {
                const message = JSON.parse(evt.data);
                const isRefresh = message.type === 'refresh';
                const isUncachableResponse = message.type === 'uncachable-response';

                if (isRefresh) {
                    location.reload();
                }

                if (isUncachableResponse) {
                    // response code is 300 or more
                }
            }

            if (registration.installing) {
                console.log("Service worker installing");
            } else if (registration.waiting) {
                console.log("Service worker installed");
            } else if (registration.active) {
                console.log("Service worker active");
            }
        } catch (error) {
            console.error(`Registration failed with ${error}`);
        }
    }
};


registerServiceWorker();