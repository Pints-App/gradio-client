var fn = new Intl.Collator(0, { numeric: 1 }).compare;
function semiver(a, b, bool) {
  a = a.split(".");
  b = b.split(".");
  return fn(a[0], b[0]) || fn(a[1], b[1]) || (b[2] = b.slice(2).join("."), bool = /[.-]/.test(a[2] = a.slice(2).join(".")), bool == /[.-]/.test(b[2]) ? fn(a[2], b[2]) : bool ? -1 : 1);
}
function determine_protocol(endpoint) {
  if (endpoint.startsWith("http")) {
    const { protocol, host } = new URL(endpoint);
    if (host.endsWith("hf.space")) {
      return {
        ws_protocol: "wss",
        host,
        http_protocol: protocol
      };
    } else {
      return {
        ws_protocol: protocol === "https:" ? "wss" : "ws",
        http_protocol: protocol,
        host
      };
    }
  }
  return {
    ws_protocol: "wss",
    http_protocol: "https:",
    host: endpoint
  };
}
const RE_SPACE_NAME = /^[^\/]*\/[^\/]*$/;
const RE_SPACE_DOMAIN = /.*hf\.space\/{0,1}$/;
async function process_endpoint(app_reference, token) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const _app_reference = app_reference.trim();
  if (RE_SPACE_NAME.test(_app_reference)) {
    try {
      const res = await fetch(
        `https://huggingface.co/api/spaces/${_app_reference}/host`,
        { headers }
      );
      if (res.status !== 200)
        throw new Error("Space metadata could not be loaded.");
      const _host = (await res.json()).host;
      return {
        space_id: app_reference,
        ...determine_protocol(_host)
      };
    } catch (e) {
      throw new Error("Space metadata could not be loaded." + e.message);
    }
  }
  if (RE_SPACE_DOMAIN.test(_app_reference)) {
    const { ws_protocol, http_protocol, host } = determine_protocol(_app_reference);
    return {
      space_id: host.replace(".hf.space", ""),
      ws_protocol,
      http_protocol,
      host
    };
  }
  return {
    space_id: false,
    ...determine_protocol(_app_reference)
  };
}
function map_names_to_ids(fns) {
  let apis = {};
  fns.forEach(({ api_name }, i) => {
    if (api_name)
      apis[api_name] = i;
  });
  return apis;
}
const RE_DISABLED_DISCUSSION = /^(?=[^]*\b[dD]iscussions{0,1}\b)(?=[^]*\b[dD]isabled\b)[^]*$/;
async function discussions_enabled(space_id) {
  try {
    const r = await fetch(
      `https://huggingface.co/api/spaces/${space_id}/discussions`,
      {
        method: "HEAD"
      }
    );
    const error = r.headers.get("x-error-message");
    if (error && RE_DISABLED_DISCUSSION.test(error))
      return false;
    else
      return true;
  } catch (e) {
    return false;
  }
}
async function get_space_hardware(space_id, token) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    const res = await fetch(
      `https://huggingface.co/api/spaces/${space_id}/runtime`,
      { headers }
    );
    if (res.status !== 200)
      throw new Error("Space hardware could not be obtained.");
    const { hardware } = await res.json();
    return hardware;
  } catch (e) {
    throw new Error(e.message);
  }
}
async function set_space_hardware(space_id, new_hardware, token) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    const res = await fetch(
      `https://huggingface.co/api/spaces/${space_id}/hardware`,
      { headers, body: JSON.stringify(new_hardware) }
    );
    if (res.status !== 200)
      throw new Error(
        "Space hardware could not be set. Please ensure the space hardware provided is valid and that a Hugging Face token is passed in."
      );
    const { hardware } = await res.json();
    return hardware;
  } catch (e) {
    throw new Error(e.message);
  }
}
async function set_space_timeout(space_id, timeout, token) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    const res = await fetch(
      `https://huggingface.co/api/spaces/${space_id}/hardware`,
      { headers, body: JSON.stringify({ seconds: timeout }) }
    );
    if (res.status !== 200)
      throw new Error(
        "Space hardware could not be set. Please ensure the space hardware provided is valid and that a Hugging Face token is passed in."
      );
    const { hardware } = await res.json();
    return hardware;
  } catch (e) {
    throw new Error(e.message);
  }
}
const hardware_types = [
  "cpu-basic",
  "cpu-upgrade",
  "t4-small",
  "t4-medium",
  "a10g-small",
  "a10g-large",
  "a100-large"
];
const QUEUE_FULL_MSG = "This application is too busy. Keep trying!";
const BROKEN_CONNECTION_MSG = "Connection errored out.";
async function post_data(url, body, token) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  try {
    var response = await fetch(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers
    });
  } catch (e) {
    return [{ error: BROKEN_CONNECTION_MSG }, 500];
  }
  const output = await response.json();
  return [output, response.status];
}
let NodeBlob;
async function upload_files(root, files, token) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const formData = new FormData();
  files.forEach((file) => {
    formData.append("files", file);
  });
  try {
    var response = await fetch(`${root}/upload`, {
      method: "POST",
      body: formData,
      headers
    });
  } catch (e) {
    return { error: BROKEN_CONNECTION_MSG };
  }
  const output = await response.json();
  return { files: output };
}
async function duplicate(app_reference, options) {
  const { hf_token, private: _private, hardware, timeout } = options;
  if (hardware && !hardware_types.includes(hardware)) {
    throw new Error(
      `Invalid hardware type provided. Valid types are: ${hardware_types.map((v) => `"${v}"`).join(",")}.`
    );
  }
  const headers = {
    Authorization: `Bearer ${hf_token}`
  };
  const user = (await (await fetch(`https://huggingface.co/api/whoami-v2`, {
    headers
  })).json()).name;
  const space_name = app_reference.split("/")[1];
  const body = {
    repository: `${user}/${space_name}`
  };
  if (_private) {
    body.private = true;
  }
  try {
    const response = await fetch(
      `https://huggingface.co/api/spaces/${app_reference}/duplicate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body)
      }
    );
    if (response.status === 409) {
      return client(`${user}/${space_name}`, options);
    } else {
      const duplicated_space = await response.json();
      let original_hardware;
      if (!hardware) {
        original_hardware = await get_space_hardware(app_reference, hf_token);
      }
      const requested_hardware = hardware || original_hardware || "cpu-basic";
      await set_space_hardware(
        `${user}/${space_name}`,
        requested_hardware,
        hf_token
      );
      await set_space_timeout(
        `${user}/${space_name}`,
        timeout || 300,
        hf_token
      );
      return client(duplicated_space.url, options);
    }
  } catch (e) {
    throw new Error(e);
  }
}
async function client(app_reference, options = { normalise_files: true }) {
  return new Promise(async (res) => {
    const { status_callback, hf_token, normalise_files } = options;
    const return_obj = {
      predict,
      submit,
      view_api
      // duplicate
    };
    let transform_files = normalise_files ?? true;
    if (typeof window === "undefined" || !("WebSocket" in window)) {
      const ws = await import("./wrapper-b7460963.js");
      NodeBlob = (await import("node:buffer")).Blob;
      global.WebSocket = ws.WebSocket;
    }
    const { ws_protocol, http_protocol, host, space_id } = await process_endpoint(app_reference, hf_token);
    const session_hash = Math.random().toString(36).substring(2);
    const last_status = {};
    let config;
    let api_map = {};
    let jwt = false;
    if (hf_token && space_id) {
      jwt = await get_jwt(space_id, hf_token);
    }
    async function config_success(_config) {
      config = _config;
      api_map = map_names_to_ids((_config == null ? void 0 : _config.dependencies) || []);
      try {
        api = await view_api(config);
      } catch (e) {
        console.error(`Could not get api details: ${e.message}`);
      }
      return {
        config,
        ...return_obj
      };
    }
    let api;
    async function handle_space_sucess(status) {
      if (status_callback)
        status_callback(status);
      if (status.status === "running")
        try {
          config = await resolve_config(`${http_protocol}//${host}`, hf_token);
          const _config = await config_success(config);
          res(_config);
        } catch (e) {
          if (status_callback) {
            status_callback({
              status: "error",
              message: "Could not load this space.",
              load_status: "error",
              detail: "NOT_FOUND"
            });
          }
        }
    }
    try {
      config = await resolve_config(`${http_protocol}//${host}`, hf_token);
      const _config = await config_success(config);
      res(_config);
    } catch (e) {
      if (space_id) {
        check_space_status(
          space_id,
          RE_SPACE_NAME.test(space_id) ? "space_name" : "subdomain",
          handle_space_sucess
        );
      } else {
        if (status_callback)
          status_callback({
            status: "error",
            message: "Could not load this space.",
            load_status: "error",
            detail: "NOT_FOUND"
          });
      }
    }
    function predict(endpoint, data, event_data) {
      let data_returned = false;
      let status_complete = false;

      const streamOutput = data[7]

      if(streamOutput) {
        const app = submit(endpoint, data, event_data);

        // if we need to stream, we will return the ref to app and handle the rest in caller
        return Promise.resolve(app)
      }

      return new Promise((res2, rej) => {
        const app = submit(endpoint, data, event_data);
        app.on("data", (d) => {
          data_returned = true;
          if (status_complete) {
            app.destroy();
          }
          res2(d);
        }).on("status", (status) => {
          if (status.stage === "error")
            rej(status);
          if (status.stage === "complete" && data_returned) {
            app.destroy();
          }
          if (status.stage === "complete") {
            status_complete = true;
          }
        });
      });
    }
    function submit(endpoint, data, event_data) {
      let fn_index;
      let api_info;
      if (typeof endpoint === "number") {
        fn_index = endpoint;
        api_info = api.unnamed_endpoints[fn_index];
      } else {
        const trimmed_endpoint = endpoint.replace(/^\//, "");
        fn_index = api_map[trimmed_endpoint];
        api_info = api.named_endpoints[endpoint.trim()];
      }
      if (typeof fn_index !== "number") {
        throw new Error(
          "There is no endpoint matching that name of fn_index matching that number."
        );
      }
      let websocket;
      const _endpoint = typeof endpoint === "number" ? "/predict" : endpoint;
      let payload;
      let complete = false;
      const listener_map = {};
      handle_blob(
        `${http_protocol}//${host + config.path}`,
        data,
        api_info,
        hf_token
      ).then((_payload) => {
        payload = { data: _payload || [], event_data, fn_index };
        if (skip_queue(fn_index, config)) {
          fire_event({
            type: "status",
            endpoint: _endpoint,
            stage: "pending",
            queue: false,
            fn_index,
            time: /* @__PURE__ */ new Date()
          });
          post_data(
            `${http_protocol}//${host + config.path}/run${_endpoint.startsWith("/") ? _endpoint : `/${_endpoint}`}`,
            {
              ...payload,
              session_hash
            },
            hf_token
          ).then(([output, status_code]) => {
            transform_files ? transform_output(
              output.data,
              api_info,
              config.root,
              config.root_url
            ) : output.data;
            if (status_code == 200) {
              fire_event({
                type: "data",
                endpoint: _endpoint,
                fn_index,
                data: output.data,
                time: /* @__PURE__ */ new Date()
              });
              fire_event({
                type: "status",
                endpoint: _endpoint,
                fn_index,
                stage: "complete",
                eta: output.average_duration,
                queue: false,
                time: /* @__PURE__ */ new Date()
              });
            } else {
              fire_event({
                type: "status",
                stage: "error",
                endpoint: _endpoint,
                fn_index,
                message: output.error,
                queue: false,
                time: /* @__PURE__ */ new Date()
              });
            }
          }).catch((e) => {
            fire_event({
              type: "status",
              stage: "error",
              message: e.message,
              endpoint: _endpoint,
              fn_index,
              queue: false,
              time: /* @__PURE__ */ new Date()
            });
          });
        } else {
          fire_event({
            type: "status",
            stage: "pending",
            queue: true,
            endpoint: _endpoint,
            fn_index,
            time: /* @__PURE__ */ new Date()
          });
          let url = new URL(`${ws_protocol}://${host}${config.path}
						/queue/join`);
          if (jwt) {
            url.searchParams.set("__sign", jwt);
          }
          websocket = new WebSocket(url);
          websocket.onclose = (evt) => {
            if (!evt.wasClean) {
              fire_event({
                type: "status",
                stage: "error",
                message: BROKEN_CONNECTION_MSG,
                queue: true,
                endpoint: _endpoint,
                fn_index,
                time: /* @__PURE__ */ new Date()
              });
            }
          };
          websocket.onmessage = function(event) {
            const _data = JSON.parse(event.data);
            const { type, status, data: data2 } = handle_message(
              _data,
              last_status[fn_index]
            );
            if (type === "update" && status && !complete) {
              fire_event({
                type: "status",
                endpoint: _endpoint,
                fn_index,
                time: /* @__PURE__ */ new Date(),
                ...status
              });
              if (status.stage === "error") {
                websocket.close();
              }
            } else if (type === "hash") {
              websocket.send(JSON.stringify({ fn_index, session_hash }));
              return;
            } else if (type === "data") {
              websocket.send(JSON.stringify({ ...payload, session_hash }));
            } else if (type === "complete") {
              complete = status;
            } else if (type === "generating") {
              fire_event({
                type: "status",
                time: /* @__PURE__ */ new Date(),
                ...status,
                stage: status == null ? void 0 : status.stage,
                queue: true,
                endpoint: _endpoint,
                fn_index
              });
            }
            if (data2) {
              fire_event({
                type: "data",
                time: /* @__PURE__ */ new Date(),
                data: transform_files ? transform_output(
                  data2.data,
                  api_info,
                  config.root,
                  config.root_url
                ) : data2.data,
                endpoint: _endpoint,
                fn_index
              });
              if (complete) {
                fire_event({
                  type: "status",
                  time: /* @__PURE__ */ new Date(),
                  ...complete,
                  stage: status == null ? void 0 : status.stage,
                  queue: true,
                  endpoint: _endpoint,
                  fn_index
                });
                websocket.close();
              }
            }
          };
          if (semiver(config.version || "2.0.0", "3.6") < 0) {
            addEventListener(
              "open",
              () => websocket.send(JSON.stringify({ hash: session_hash }))
            );
          }
        }
      });
      function fire_event(event) {
        const narrowed_listener_map = listener_map;
        let listeners = narrowed_listener_map[event.type] || [];
        listeners == null ? void 0 : listeners.forEach((l) => l(event));
      }
      function on(eventType, listener) {
        const narrowed_listener_map = listener_map;
        let listeners = narrowed_listener_map[eventType] || [];
        narrowed_listener_map[eventType] = listeners;
        listeners == null ? void 0 : listeners.push(listener);
        return { on, off, cancel, destroy };
      }
      function off(eventType, listener) {
        const narrowed_listener_map = listener_map;
        let listeners = narrowed_listener_map[eventType] || [];
        listeners = listeners == null ? void 0 : listeners.filter((l) => l !== listener);
        narrowed_listener_map[eventType] = listeners;
        return { on, off, cancel, destroy };
      }
      async function cancel() {
        const _status = {
          stage: "complete",
          queue: false,
          time: /* @__PURE__ */ new Date()
        };
        complete = _status;
        fire_event({
          ..._status,
          type: "status",
          endpoint: _endpoint,
          fn_index
        });
        if (websocket && websocket.readyState === 0) {
          websocket.addEventListener("open", () => {
            websocket.close();
          });
        } else {
          websocket.close();
        }
        try {
          await fetch(`${http_protocol}//${host + config.path}/reset`, {
            headers: { "Content-Type": "application/json" },
            method: "POST",
            body: JSON.stringify({ fn_index, session_hash })
          });
        } catch (e) {
          console.warn(
            "The `/reset` endpoint could not be called. Subsequent endpoint results may be unreliable."
          );
        }
      }
      function destroy() {
        for (const event_type in listener_map) {
          listener_map[event_type].forEach((fn2) => {
            off(event_type, fn2);
          });
        }
      }
      return {
        on,
        off,
        cancel,
        destroy
      };
    }
    async function view_api(config2) {
      if (api)
        return api;
      const headers = { "Content-Type": "application/json" };
      if (hf_token) {
        headers.Authorization = `Bearer ${hf_token}`;
      }
      try {
        let response;
        if (semiver(config2.version || "2.0.0", "3.30") < 0) {
          response = await fetch(
            "https://gradio-space-api-fetcher-v2.hf.space/api",
            {
              method: "POST",
              body: JSON.stringify({
                serialize: false,
                config: JSON.stringify(config2)
              }),
              headers
            }
          );
        } else {
          response = await fetch(`${http_protocol}//${host}/info`, {
            headers
          });
        }
        let api_info = await response.json();
        if ("api" in api_info) {
          api_info = api_info.api;
        }
        if (api_info.named_endpoints["/predict"] && !api_info.unnamed_endpoints["0"]) {
          api_info.unnamed_endpoints[0] = api_info.named_endpoints["/predict"];
        }
        const x = transform_api_info(api_info, config2, api_map);
        return x;
      } catch (e) {
        return [{ error: BROKEN_CONNECTION_MSG }, 500];
      }
    }
  });
}
function transform_output(data, api_info, root_url, remote_url) {
  let transformed_data = data.map((d, i) => {
    var _a, _b, _c, _d;
    if (((_b = (_a = api_info.returns) == null ? void 0 : _a[i]) == null ? void 0 : _b.component) === "File") {
      return normalise_file(d, root_url, remote_url);
    } else if (((_d = (_c = api_info.returns) == null ? void 0 : _c[i]) == null ? void 0 : _d.component) === "Gallery") {
      return d.map((img) => {
        return Array.isArray(img) ? [normalise_file(img[0], root_url, remote_url), img[1]] : [normalise_file(img, root_url, remote_url), null];
      });
    } else if (typeof d === "object" && d.is_file) {
      return normalise_file(d, root_url, remote_url);
    } else {
      return d;
    }
  });
  return transformed_data;
}
function normalise_file(file, root, root_url) {
  if (file == null)
    return null;
  if (typeof file === "string") {
    return {
      name: "file_data",
      data: file
    };
  } else if (Array.isArray(file)) {
    const normalized_file = [];
    for (const x of file) {
      if (x === null) {
        normalized_file.push(null);
      } else {
        normalized_file.push(normalise_file(x, root, root_url));
      }
    }
    return normalized_file;
  } else if (file.is_file) {
    if (!root_url) {
      file.data = root + "/file=" + file.name;
    } else {
      file.data = "/proxy=" + root_url + "/file=" + file.name;
    }
  }
  return file;
}
function get_type(type, component, serializer, signature_type) {
  switch (type.type) {
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "number":
      return "number";
  }
  if (serializer === "JSONSerializable" || serializer === "StringSerializable") {
    return "any";
  } else if (serializer === "ListStringSerializable") {
    return "string[]";
  } else if (component === "Image") {
    return signature_type === "parameter" ? "Blob | File | Buffer" : "string";
  } else if (serializer === "FileSerializable") {
    if ((type == null ? void 0 : type.type) === "array") {
      return signature_type === "parameter" ? "(Blob | File | Buffer)[]" : `{ name: string; data: string; size?: number; is_file?: boolean; orig_name?: string}[]`;
    } else {
      return signature_type === "parameter" ? "Blob | File | Buffer" : `{ name: string; data: string; size?: number; is_file?: boolean; orig_name?: string}`;
    }
  } else if (serializer === "GallerySerializable") {
    return signature_type === "parameter" ? "[(Blob | File | Buffer), (string | null)][]" : `[{ name: string; data: string; size?: number; is_file?: boolean; orig_name?: string}, (string | null))][]`;
  }
}
function get_description(type, serializer) {
  if (serializer === "GallerySerializable") {
    return "array of [file, label] tuples";
  } else if (serializer === "ListStringSerializable") {
    return "array of strings";
  } else if (serializer === "FileSerializable") {
    return "array of files or single file";
  } else {
    return type.description;
  }
}
function transform_api_info(api_info, config, api_map) {
  const new_data = {
    named_endpoints: {},
    unnamed_endpoints: {}
  };
  for (const key in api_info) {
    const cat = api_info[key];
    for (const endpoint in cat) {
      const dep_index = config.dependencies[endpoint] ? endpoint : api_map[endpoint.replace("/", "")];
      const info = cat[endpoint];
      new_data[key][endpoint] = {};
      new_data[key][endpoint].parameters = {};
      new_data[key][endpoint].returns = {};
      new_data[key][endpoint].type = config.dependencies[dep_index].types;
      new_data[key][endpoint].parameters = info.parameters.map(
        ({ label, component, type, serializer }) => ({
          label,
          component,
          type: get_type(type, component, serializer, "parameter"),
          description: get_description(type, serializer)
        })
      );
      new_data[key][endpoint].returns = info.returns.map(
        ({ label, component, type, serializer }) => ({
          label,
          component,
          type: get_type(type, component, serializer, "return"),
          description: get_description(type, serializer)
        })
      );
    }
  }
  return new_data;
}
async function get_jwt(space, token) {
  try {
    const r = await fetch(`https://huggingface.co/api/spaces/${space}/jwt`, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const jwt = (await r.json()).token;
    return jwt || false;
  } catch (e) {
    console.error(e);
    return false;
  }
}
async function handle_blob(endpoint, data, api_info, token) {
  const blob_refs = await walk_and_store_blobs(
    data,
    void 0,
    [],
    true,
    api_info
  );
  return new Promise((res) => {
    Promise.all(
      blob_refs.map(async ({ path, blob, data: data2, type }) => {
        if (blob) {
          const file_url = (await upload_files(endpoint, [blob], token)).files[0];
          return { path, file_url, type };
        } else {
          return { path, base64: data2, type };
        }
      })
    ).then((r) => {
      r.forEach(({ path, file_url, base64, type }) => {
        if (base64) {
          update_object(data, base64, path);
        } else if (type === "Gallery") {
          update_object(data, file_url, path);
        } else if (file_url) {
          const o = {
            is_file: true,
            name: `${file_url}`,
            data: null
            // orig_name: "file.csv"
          };
          update_object(data, o, path);
        }
      });
      res(data);
    }).catch(console.log);
  });
}
function update_object(object, newValue, stack) {
  while (stack.length > 1) {
    object = object[stack.shift()];
  }
  object[stack.shift()] = newValue;
}
async function walk_and_store_blobs(param, type = void 0, path = [], root = false, api_info = void 0) {
  if (Array.isArray(param)) {
    let blob_refs = [];
    await Promise.all(
      param.map(async (v, i) => {
        var _a;
        let new_path = path.slice();
        new_path.push(i);
        const array_refs = await walk_and_store_blobs(
          param[i],
          root ? ((_a = api_info == null ? void 0 : api_info.parameters[i]) == null ? void 0 : _a.component) || void 0 : type,
          new_path,
          false,
          api_info
        );
        blob_refs = blob_refs.concat(array_refs);
      })
    );
    return blob_refs;
  } else if (globalThis.Buffer && param instanceof globalThis.Buffer) {
    const is_image = type === "Image";
    return [
      {
        path,
        blob: is_image ? false : new NodeBlob([param]),
        data: is_image ? `${param.toString("base64")}` : false,
        type
      }
    ];
  } else if (param instanceof Blob || typeof window !== "undefined" && param instanceof File) {
    if (type === "Image") {
      let data;
      if (typeof window !== "undefined") {
        data = await image_to_data_uri(param);
      } else {
        const buffer = await param.arrayBuffer();
        data = Buffer.from(buffer).toString("base64");
      }
      return [{ path, data, type }];
    } else {
      return [{ path, blob: param, type }];
    }
  } else if (typeof param === "object") {
    let blob_refs = [];
    for (let key in param) {
      if (param.hasOwnProperty(key)) {
        let new_path = path.slice();
        new_path.push(key);
        blob_refs = blob_refs.concat(
          await walk_and_store_blobs(
            param[key],
            void 0,
            new_path,
            false,
            api_info
          )
        );
      }
    }
    return blob_refs;
  } else {
    return [];
  }
}
function image_to_data_uri(blob) {
  return new Promise((resolve, _) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}
function skip_queue(id, config) {
  var _a, _b, _c, _d;
  return !(((_b = (_a = config == null ? void 0 : config.dependencies) == null ? void 0 : _a[id]) == null ? void 0 : _b.queue) === null ? config.enable_queue : (_d = (_c = config == null ? void 0 : config.dependencies) == null ? void 0 : _c[id]) == null ? void 0 : _d.queue) || false;
}
async function resolve_config(endpoint, token) {
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (typeof window !== "undefined" && window.gradio_config && location.origin !== "http://localhost:9876") {
    const path = window.gradio_config.root;
    const config = window.gradio_config;
    config.root = endpoint + config.root;
    return { ...config, path };
  } else if (endpoint) {
    let response = await fetch(`${endpoint}/config`, { headers });
    if (response.status === 200) {
      const config = await response.json();
      config.path = config.path ?? "";
      config.root = endpoint;
      return config;
    } else {
      throw new Error("Could not get config.");
    }
  }
  throw new Error("No config or app endpoint found");
}
async function check_space_status(id, type, status_callback) {
  let endpoint = type === "subdomain" ? `https://huggingface.co/api/spaces/by-subdomain/${id}` : `https://huggingface.co/api/spaces/${id}`;
  let response;
  let _status;
  try {
    response = await fetch(endpoint);
    _status = response.status;
    if (_status !== 200) {
      throw new Error();
    }
    response = await response.json();
  } catch (e) {
    status_callback({
      status: "error",
      load_status: "error",
      message: "Could not get space status",
      detail: "NOT_FOUND"
    });
    return;
  }
  if (!response || _status !== 200)
    return;
  const {
    runtime: { stage },
    id: space_name
  } = response;
  switch (stage) {
    case "STOPPED":
    case "SLEEPING":
      status_callback({
        status: "sleeping",
        load_status: "pending",
        message: "Space is asleep. Waking it up...",
        detail: stage
      });
      setTimeout(() => {
        check_space_status(id, type, status_callback);
      }, 1e3);
      break;
    case "RUNNING":
    case "RUNNING_BUILDING":
      status_callback({
        status: "running",
        load_status: "complete",
        message: "",
        detail: stage
      });
      break;
    case "BUILDING":
      status_callback({
        status: "building",
        load_status: "pending",
        message: "Space is building...",
        detail: stage
      });
      setTimeout(() => {
        check_space_status(id, type, status_callback);
      }, 1e3);
      break;
    default:
      status_callback({
        status: "space_error",
        load_status: "error",
        message: "This space is experiencing an issue.",
        detail: stage,
        discussions_enabled: await discussions_enabled(space_name)
      });
      break;
  }
}
function handle_message(data, last_status) {
  const queue = true;
  switch (data.msg) {
    case "send_data":
      return { type: "data" };
    case "send_hash":
      return { type: "hash" };
    case "queue_full":
      return {
        type: "update",
        status: {
          queue,
          message: QUEUE_FULL_MSG,
          stage: "error",
          code: data.code,
          success: data.success
        }
      };
    case "estimation":
      return {
        type: "update",
        status: {
          queue,
          stage: last_status || "pending",
          code: data.code,
          size: data.queue_size,
          position: data.rank,
          eta: data.rank_eta,
          success: data.success
        }
      };
    case "progress":
      return {
        type: "update",
        status: {
          queue,
          stage: "pending",
          code: data.code,
          progress_data: data.progress_data,
          success: data.success
        }
      };
    case "process_generating":
      return {
        type: "generating",
        status: {
          queue,
          message: !data.success ? data.output.error : null,
          stage: data.success ? "generating" : "error",
          code: data.code,
          progress_data: data.progress_data,
          eta: data.average_duration
        },
        data: data.success ? data.output : null
      };
    case "process_completed":
      return {
        type: "complete",
        status: {
          queue,
          message: !data.success ? data.output.error : void 0,
          stage: data.success ? "complete" : "error",
          code: data.code,
          progress_data: data.progress_data,
          eta: data.output.average_duration
        },
        data: data.success ? data.output : null
      };
    case "process_starts":
      return {
        type: "update",
        status: {
          queue,
          stage: "pending",
          code: data.code,
          size: data.rank,
          position: 0,
          success: data.success
        }
      };
  }
  return { type: "none", status: { stage: "error", queue } };
}
export {
  client,
  duplicate,
  post_data,
  upload_files
};
