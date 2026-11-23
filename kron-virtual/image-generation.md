# Image generation

This describes the proposed feature set for image generation

## Use cases

### Avatar image generation

The system will be able to generate an image and save it to the backend associated with a character or persona.  Characters and personas can have more than one image, and one as a default.  This image will show next to their card or in chat sessions

### Session image generation

In an RP chat session, the user will be able to request an image of the avator combined with the current scene

### combined image generation

For a given character or persona in an RP chat session, user will be able to use an avatar image of the current character and persona to generate a scene that includes both.


### Image studio

A separate playground for user to 

* generate images from avatar or custom description
* use image-to-image functionality with any images generated from the system (one ore more) and prompt to generate new image
* a place to update an default templates used in the system for any of the avatar, session, or combined image generation




## Mechanism

* Avatar generation will use text-to-image generation
* Session and combined image generation will use image-to-image generation referencing the character or both the character and persona avatars as image uploads to URL and well form prompt to describe the neeeded resulting image


## Image platform

There is a wiro.ai image generation platform that will be used.  This platform has API access to hundreds of image generators, but will be limited to one image.   Below is the markdown file for usage of the particular model to guide implementation of the API flow

# ByteDance/seedream 5.5 uncensored advanced wiro.ai

## Basic tool info

Model name: ByteDance/seedream 5.5 uncensored advanced
Model description: ByteDance Seedream 5.5 Uncensored Advanced generates images or edits up to 10 references from one prompt, with JPEG or transparent PNG output options.
Model cover: https://cdn.wiro.ai/uploads/models/bytedance-seedream-5-5-uncensored-advanced-cover.webp
Model categories:
  - tool
  - partner
  - ByteDance
  - image-to-image
  - text-to-image
  - price-list
  - nogpu-pipeline
  - image-editing
  - image-compare

Model tags:
  - ByteDance

Run Task Endpoint (POST):
https://api.wiro.ai/v1/Run/bytedance/seedream-5-5-uncensored-advanced

Get Task Detail Endpoint (POST):
https://api.wiro.ai/v1/Task/Detail

## Model Inputs: 

  - name: inputImage
    label: Input Image
    help: Optional. Up to 10 images to edit or combine. Without an image, the model generates from the prompt.
    type: combinefileinput
    default: https://cdn.wiro.ai/uploads/sampleinputs/bytedance-seedream-5-5-uncensored-advanced-sampleinput-1.webp

  - name: prompt
    label: Prompt
    help: Required.
    type: textarea
    default: Keep the same woman, her face and long black hair exactly the same. She now wears black lace lingerie and sits sideways on the wide window ledge of a luxurious Paris hotel suite at night, one knee raised, leaning back against the window frame and looking at the camera with a soft confident smile, the illuminated Eiffel Tower glowing through the glass beside her, warm lamplight, high-end fashion editorial photo.

  - name: width
    label: Width
    help: Required. Output width in pixels. Width x height must be between 921,600 and 4,624,220 pixels, with a ratio between 1:16 and 16:1.
    type: number
    default: 1024

  - name: height
    label: Height
    help: Required. Output height in pixels. Width x height must be between 921,600 and 4,624,220 pixels, with a ratio between 1:16 and 16:1.
    type: number
    default: 1024

  - name: background
    label: Background
    help: Optional. Default auto. Transparent returns a png with a transparent background, for stickers, icons and product cutouts.
    type: select
    default: auto
    options:
      - value: "auto"
        label: auto

      - value: "transparent"
        label: transparent

      - value: "opaque"
        label: opaque

  - name: outputFormat
    label: Output Format
    help: Optional. Default jpeg.
    type: select
    default: jpeg
    options:
      - value: "jpeg"
        label: jpeg

      - value: "png"
        label: png

  - name: watermark
    label: Watermark
    help: Optional. Default false. Adds an "AI generated" mark in the lower-right corner.
    type: select
    default: false
    options:
      - value: "false"
        label: false

      - value: "true"
        label: true



## Integration Header Prepare 
```bash
  # Sign up Wiro dashboard and create project
  export YOUR_API_KEY="YOUR_WIRO_API_KEY"; 
  export YOUR_API_SECRET="XXXXXXXXX"; 

  # unix time or any random integer value
  export NONCE=$(date +%s);

  # hmac-SHA256 (YOUR_API_SECRET+Nonce) with YOUR_API_KEY
  export SIGNATURE="$(echo -n "${YOUR_API_SECRET}${NONCE}" | openssl dgst -sha256 -hmac "${YOUR_API_KEY}" | awk '{print $NF}')";
```

## Run Command - Make HTTP Post Request 
```bash
curl -X POST "https://api.wiro.ai/v1/Run/bytedance/seedream-5-5-uncensored-advanced" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${YOUR_API_KEY}" \
  -H "x-nonce: ${NONCE}" \
  -H "x-signature: ${SIGNATURE}" \
  --data-binary @- <<'JSON'
{
  "inputImage": [
    "https://cdn.wiro.ai/uploads/sampleinputs/bytedance-seedream-5-5-uncensored-advanced-sampleinput-1.webp"
  ],
  "prompt": "Keep the same woman, her face and long black hair exactly the same. She now wears black lace lingerie and sits sideways on the wide window ledge of a luxurious Paris hotel suite at night, one knee raised, leaning back against the window frame and looking at the camera with a soft confident smile, the illuminated Eiffel Tower glowing through the glass beside her, warm lamplight, high-end fashion editorial photo.",
  "width": 1024,
  "height": 1024,
  "background": "auto",
  "outputFormat": "jpeg",
  "watermark": "false",
  "callbackUrl": "You can provide a callback URL; Wiro will send a POST request to it when the task is completed."
}
JSON
```


## Run Command - Response
```json
{
    "errors": [],
    "taskid": "2221",
    "socketaccesstoken": "eDcCm5yyUfIvMFspTwww49OUfgXkQt",
    "result": true
}
```


## Get Task Detail - Make HTTP Post Request with Task ID
```bash
curl -X POST "https://api.wiro.ai/v1/Task/Detail" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${YOUR_API_KEY}" \
  -H "x-nonce: ${NONCE}" \
  -H "x-signature: ${SIGNATURE}" \
  -d '{
  "taskid": "2221"
}';
```

## Get Task Detail - Make HTTP Post Request with Socket Access Token
```bash
curl -X POST "https://api.wiro.ai/v1/Task/Detail" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${YOUR_API_KEY}" \
  -H "x-nonce: ${NONCE}" \
  -H "x-signature: ${SIGNATURE}" \
  -d '{
  "tasktoken": "eDcCm5yyUfIvMFspTwww49OUfgXkQt"
}';
```

## Get Task Detail - Response
```json
{
  "total": "1",
  "errors": [],
  "tasklist": [
      {
          "id": "2221",
          "uuid": "15bce51f-442f-4f44-a71d-13c6374a62bd",
          "socketaccesstoken": "eDcCm5yyUfIvMFspTwww49OUfgXkQt",
          "parameters": {},
          "debugoutput": "",
          "debugerror": "",
          "starttime": "1734513809",
          "endtime": "1734513813",
          "elapsedseconds": "6.0000",
          "status": "task_postprocess_end",
          "createtime": "1734513807",
          "canceltime": "0",
          "assigntime": "1734513807",
          "accepttime": "1734513807",
          "preprocessstarttime": "1734513807",
          "preprocessendtime": "1734513807",
          "postprocessstarttime": "1734513813",
          "postprocessendtime": "1734513814",
          "totalcost": "0.003510000000",
          "chargedcost": "0.002808000000",
          "discountamount": "0.000702000000",
          "outputs": [
              {
                  "id": "6bc392c93856dfce3a7d1b4261e15af3",
                  "name": "0.png",
                  "contenttype": "image/png",
                  "parentid": "6c1833f39da71e6175bf292b18779baf",
                  "uuid": "15bce51f-442f-4f44-a71d-13c6374a62bd",
                  "size": "202472",
                  "addedtime": "1734513812",
                  "modifiedtime": "1734513812",
                  "accesskey": "dFKlMApaSgMeHKsJyaDeKrefcHahUK",
                  "url": "https://cdn1.wiro.ai/6a6af820-c5050aee-40bd7b83-a2e186c6-7f61f7da-3894e49c-fc0eeb66-9b500fe2/0.png"
              }
          ],
          "size": "202472"
          }
      ],
  "result": true
}
```

totalcost is the list price. chargedcost is the amount actually billed after any discount (a store fee is included on store runs); discountamount is the discount. chargedcost is null until the charge is recorded (shortly after task_postprocess_end) and "0" for a failed or cancelled task.


## Kill Task - Make HTTP Post Request with Task ID
```bash
curl -X POST "https://api.wiro.ai/v1/Task/Kill" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${YOUR_API_KEY}" \
  -H "x-nonce: ${NONCE}" \
  -H "x-signature: ${SIGNATURE}" \
  -d '{
  "taskid": "534574"
}';
```

## Kill Task - Make HTTP Post Request with Socket Access Token
```bash
curl -X POST "https://api.wiro.ai/v1/Task/Kill" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${YOUR_API_KEY}" \
  -H "x-nonce: ${NONCE}" \
  -H "x-signature: ${SIGNATURE}" \
  -d '{
  "socketaccesstoken": "ZpYote30on42O4jjHXNiKmrWAZqbRE"
}';
```

## Kill Task - Response
```json
{
  "errors": [],
  "tasklist": [
      {
          "id": "534574",
          "uuid": "15bce51f-442f-4f44-a71d-13c6374a62bd",
          "name": "",
          "socketaccesstoken": "ZpYote30on42O4jjHXNiKmrWAZqbRE",
          "parameters": {
              "inputImage": "https://api.wiro.ai/v1/File/mCmUXgZLG1FNjjjwmbtPFr2LVJA112/inputImage-6060136.png"
          },
          "debugoutput": "",
          "debugerror": "",
          "starttime": "1734513809",
          "endtime": "1734513813",
          "elapsedseconds": "6.0000",
          "status": "task_cancel",
          "cps": "0.000585000000",
          "totalcost": "0.003510000000",
          "guestid": null,
          "projectid": "699",
          "modelid": "598",
          "description": "",
          "basemodelid": "0",
          "runtype": "model",
          "modelfolderid": "",
          "modelfileid": "",
          "callbackurl": "",
          "marketplaceid": null,
          "createtime": "1734513807",
          "canceltime": "0",
          "assigntime": "1734513807",
          "accepttime": "1734513807",
          "preprocessstarttime": "1734513807",
          "preprocessendtime": "1734513807",
          "postprocessstarttime": "1734513813",
          "postprocessendtime": "1734513814",
          "pexit": "0",
          "categories": "["tool","image-to-image","quick-showcase","compare-landscape"]",
          "outputs": [
              {
                  "id": "6bc392c93856dfce3a7d1b4261e15af3",
                  "name": "0.png",
                  "contenttype": "image/png",
                  "parentid": "6c1833f39da71e6175bf292b18779baf",
                  "uuid": "15bce51f-442f-4f44-a71d-13c6374a62bd",
                  "size": "202472",
                  "addedtime": "1734513812",
                  "modifiedtime": "1734513812",
                  "accesskey": "dFKlMApaSgMeHKsJyaDeKrefcHahUK",
                  "foldercount": "0",
                  "filecount": "0",
                  "ispublic": 0,
                  "expiretime": null,
                  "url": "https://cdn1.wiro.ai/6a6af820-c5050aee-40bd7b83-a2e186c6-7f61f7da-3894e49c-fc0eeb66-9b500fe2/0.png"
              }
          ],
          "size": "202472"
      }
  ],
  "result": true
}
```

## Cancel Task - Make HTTP Post Request (For tasks on queue)
```bash
curl -X POST "https://api.wiro.ai/v1/Task/Cancel" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ${YOUR_API_KEY}" \
  -H "x-nonce: ${NONCE}" \
  -H "x-signature: ${SIGNATURE}" \
  -d '{
  "taskid": "634574"
}';
```

## Cancel Task - Response
```json
{
  "errors": [],
  "tasklist": [
      {
          "id": "634574",
          "uuid": "15bce51f-442f-4f44-a71d-13c6374a62bd",
          "name": "",
          "socketaccesstoken": "ZpYote30on42O4jjHXNiKmrWAZqbRE",
          "parameters": {
              "inputImage": "https://api.wiro.ai/v1/File/mCmUXgZLG1FNjjjwmbtPFr2LVJA112/inputImage-6060136.png"
          },
          "debugoutput": "",
          "debugerror": "",
          "starttime": "1734513809",
          "endtime": "1734513813",
          "elapsedseconds": "6.0000",
          "status": "task_cancel",
          "cps": "0.000585000000",
          "totalcost": "0.003510000000",
          "guestid": null,
          "projectid": "699",
          "modelid": "598",
          "description": "",
          "basemodelid": "0",
          "runtype": "model",
          "modelfolderid": "",
          "modelfileid": "",
          "callbackurl": "",
          "marketplaceid": null,
          "createtime": "1734513807",
          "canceltime": "0",
          "assigntime": "1734513807",
          "accepttime": "1734513807",
          "preprocessstarttime": "1734513807",
          "preprocessendtime": "1734513807",
          "postprocessstarttime": "1734513813",
          "postprocessendtime": "1734513814",
          "pexit": "0",
          "categories": "["tool","image-to-image","quick-showcase","compare-landscape"]",
          "outputs": [
              {
                  "id": "6bc392c93856dfce3a7d1b4261e15af3",
                  "name": "0.png",
                  "contenttype": "image/png",
                  "parentid": "6c1833f39da71e6175bf292b18779baf",
                  "uuid": "15bce51f-442f-4f44-a71d-13c6374a62bd",
                  "size": "202472",
                  "addedtime": "1734513812",
                  "modifiedtime": "1734513812",
                  "accesskey": "dFKlMApaSgMeHKsJyaDeKrefcHahUK",
                  "foldercount": "0",
                  "filecount": "0",
                  "ispublic": 0,
                  "expiretime": null,
                  "url": "https://cdn1.wiro.ai/6a6af820-c5050aee-40bd7b83-a2e186c6-7f61f7da-3894e49c-fc0eeb66-9b500fe2/0.png"
              }
          ],
          "size": "202472"
      }
  ],
  "result": true
}
```


## Task Status Information
This section defines the possible task status values returned by the API when polling for task completion.

### Completed Task Statuses (Polling can stop)
These indicate that the task has reached a terminal state â€” either success or failure. Once any of these is received, polling should stop.
- task_postprocess_end : Task completed successfully and post-processing is done.
- task_cancel : Task was cancelled by the user or system.

### Running Task Statuses (Continue polling)
These statuses indicate that the task is still in progress. Polling should continue if one of these is returned.
- task_queue : Task is waiting in the queue.
- task_accept : Task has been accepted for processing.
- task_assign : Task is being assigned to a worker.
- task_preprocess_start : Preprocessing is starting.
- task_preprocess_end : Preprocessing is complete.
- task_start : Task execution has started.
- task_output : Output is being generated.


# promting guidance for use of image generation in RP scenarios with one or more reference images 

To place two specific characters into a new scene without identity bleeding, assign explicit labels to each reference image, bind specific clothing and actions to each label, and describe the physical interaction and spatial layout in the scene.

## Reusable Prompt Template

Use labeled brackets or explicit image references (e.g., Image 1, Image 2) so the model separates the two identities clearly:
text
``
[TASK & COMPOSITION]
Create a [medium/style, e.g., candid 35mm photograph] featuring the two characters from Image 1 and Image 2 together in [setting/environment]. [Spatial placement, e.g., Character A is on the left, Character B is on the right], captured in a [framing, e.g., medium shot at eye level].

[CHARACTER 1 - IMAGE 1]
Preserve the exact facial features, hair, and build of the person in Image 1 ([brief anchor traits, e.g., short curly dark hair, freckles]). They are wearing [new outfit details] and are [specific pose, expression, and action].

[CHARACTER 2 - IMAGE 2]
Preserve the exact facial features, hair, and build of the person in Image 2 ([brief anchor traits, e.g., tall, silver glasses, braided hair]). They are wearing [new outfit details] and are [specific pose, expression, and action].

[INTERACTION & SCENE]
[How they interact, e.g., Character 1 is handing a coffee cup to Character 2 while both laugh]. The background shows [key environmental details, props, and depth of field].

[LIGHTING & CONSTRAINTS]
[Lighting direction, color palette, and mood]. Keep both faces clearly recognizable from their respective reference images without blending their features.
``

## Best Practices for Multi-Character Placement

• Prevent identity blending: Never rely solely on pronouns like "they" or "he/she" when describing actions or outfits; always repeat the reference anchor (the person from Image 1 or Character A) when assigning clothes or poses.
• Keep physical anchors concise: Include only 2–3 key physical traits from your character descriptions (such as hairstyle, distinctive facial features, or height difference) to reinforce the reference image rather than competing with it.
• Separate identity from wardrobe: Explicitly state that the outfits come from the prompt while the faces and builds come from the reference images, especially if the characters wear different clothes in their source photos.
• Anchor the spatial relationship: Specify who is on the left, right, foreground, or background, and describe a physical point of connection (eye contact, shared object, shoulder-to-shoulder stance) so they look naturally integrated into the same space.
• Match lighting across both subjects: Describe one unified light source hitting both characters so they don't look pasted in from separate environments.
