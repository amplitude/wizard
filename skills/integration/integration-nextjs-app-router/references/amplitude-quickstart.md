<!--production-->

<!doctype html>
<html lang="en">
<head>
  <meta name='zd-site-verification' content='od3rs5oc4ggcruhipz6rp' />
  <meta charset="utf-8">
  

  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta content="Get started with the full Amplitude platform in minutes. Which features drive retention? Where do" name="description">
  <meta name="google-site-verification" content="UHLjtoO7DV30dx3hVhwTOIWguEUr_VzS41msmq-uYKA" />
  
  <link rel="apple-touch-icon" sizes="180x180" href="/docs/assets/general/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/docs/assets/general/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/docs/assets/general/favicon-16x16.png">
  <title>Amplitude Quickstart | Amplitude</title>
  
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Article",
      "headline": "Amplitude Quickstart",
      "description": "Get started with the full Amplitude platform in minutes. Which features drive retention? Where do",
      "url": "/docs/get-started/amplitude-quickstart",
      "publisher": {
        "@type": "Organization",
        "name": "Amplitude",
        "legalName": "Amplitude, Inc.",
        "url": "https://amplitude.com",
        "logo": {
          "@type": "ImageObject",
          "url": "https://amplitude.com/nextjs-public/amplitude-default-seo.png"
        },
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "201 3rd St #200",
          "addressLocality": "San Francisco",
          "addressRegion": "CA",
          "postalCode": "94103",
          "addressCountry": "USA"
        },
        "contactPoint": {
          "@type": "ContactPoint",
          "telephone": "[+650-988-5131]",
          "contactType": "Customer Support",
          "email": "sales@amplitude.com"
        },
        "sameAs": [
          "https://twitter.com/Amplitude_HQ",
          "https://www.facebook.com/AmplitudeAnalytics/",
          "https://www.linkedin.com/company/amplitude-analytics"
        ]
      },
      "datePublished": "",
      "dateModified": "December 11th, 2025",
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": "/docs/get-started/amplitude-quickstart"
      },
      "author": [
        {
          "@type": "Organization",
          "name": "Amplitude"
        }
      ]
    }
</script>
  
    <style>
    /* Prism’s critical code-block styles only */
    code[class*="language-"],
    pre[class*="language-"] {
      color: #2a2a2a;
      background: #f5f2f0;
      font-family:"IBM Plex Mono", Consolas, Menlo, monospace;
      font-size: 0.9em;
      white-space: pre;
      /* …etc, just the essentials… */
    }
  </style>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/tocbot/4.25.0/tocbot.css">
  <link href="/docs/css/site.css?id=6e2f9e1efe9343c4ba65666223648444" rel="stylesheet">
  <link href="/docs/css/algolia.css?id=e343cc9490e043fefffa37d2817ddf8c" rel="stylesheet">
  <link href="/docs/css/dracula-prism.css?id=a5713888be640854bb66b8b74c1037ce" rel="stylesheet">
<style>
      pre[class*="language-"] code p {
  all: unset;        /* removes default block-level margins/padding */
  display: inline;   /* flow as if it were plain text */
}
</style>
  <script src="/docs/js/site.js?id=078a82617f7dafffff92da951b4ec6c9"></script>
  <script type="module" src="/docs/js/side-nav.js?id=b84c163c6c16a6a6b14fc85ee81c31e9"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/@alpinejs/collapse@3.x.x/dist/cdn.min.js"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.13.5/dist/cdn.min.js"></script>
  <link rel="preconnect" href="https://93SYI9HL20-dsn.algolia.net" crossorigin />
  <script src="https://unpkg.com/@amplitude/experiment-js-client@1.9.0/dist/experiment.umd.js"></script>
  <style>
    [x-cloak] {
      display: none !important;
    }
    .copy-btn {
      height: 24px;
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      z-index: 10;
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 0.25rem;
      opacity: 0.6;
      transition: opacity 0.2s;
    }
    
    .copy-btn:hover {
      opacity: 1;
    }
  </style>
  <script src="https://cdn.amplitude.com/script/8ec8f5cbeaf93a6717831a55add2d7a4.js"></script>
<script src="https://cdn.amplitude.com/script/8ec8f5cbeaf93a6717831a55add2d7a4.engagement.js"></script>

<script>
    window.amplitude.add(window.sessionReplay.plugin({
        sampleRate: 0.5
    }));
    window.amplitude.init('8ec8f5cbeaf93a6717831a55add2d7a4', {
        "fetchRemoteConfig": true,
        "autocapture": {
            "attribution": {
                "excludeInternalReferrers": true,
            },
            "pageViews": true,
            "sessions": true,
            "formInteractions": true,
            "fileDownloads": true,
            "elementInteractions": true,
            "pageUrlEnrichment": true,
            "webVitals": true,
        },
    });
     
    window.amplitude.add(window.engagement.plugin())
    
    function checkAuthenticatedUser() {
        try {
            const AMP_PREFIX = 'AMP_';
            const currUserId = amplitude.getUserId();

            if (!currUserId) {
                // Iterate through all amplitude cookies within amplitude domain
                const amplitudeCookies = getCookies(AMP_PREFIX);

                for (let [cookieName, cookieValue] of amplitudeCookies.map((cookies) => cookies.split('='))) {
                    const [deviceId, userId] = cookieValue.split('.');
    
                    try {
                        const userSession = JSON.parse(decodeURIComponent(atob(cookieValue)))
                        if (userSession && userSession.userId) {
                            amplitude.setUserId(userSession.userId);
                            break;
                        }
                    } catch {}
                }
            }
        } catch (e) {
            console.error(e);
        }
    }

    function getCookies(prefix) {
        try {
            const cookieArray = document.cookie.split(';').map((c) => c.trimStart());
            let values = [];
            for (let cookie of cookieArray) {
                while (cookie.charAt(0) === ' ') {
                    cookie = cookie.substring(1);
                }
                if (cookie.startsWith(prefix)) {
                    values.push(cookie.substring(name.length));
                }
            }
            return values;
        } catch (e) {
            return [];
        }
    }

    document.addEventListener("DOMContentLoaded", function () {
        checkAuthenticatedUser();
    });
</script>
<script>
    function academyClick(link) {
        amplitude.track('Academy link', {
            'destination': link,
            '[Amplitude] Page URL': window.location.href
        })
    }
</script>
<!-- Preload consolidated glossary data -->


</head>
<body class="bg-gray-100 font-sans leading-normal text-gray-800 scroll-pt-24">
  <div x-data="{ sidebarOpen: false }" class="container prose">
    <div class="top-0 left-0  right-0 bg-white fixed z-10">
      <div class="w-full pt-5 pl-5">
        <div class="box-border">
          

<div class="box-border flex flex-row flex-nowrap items-center border-solid border-b border-black-200 h-12 px-4"
    style="margin-left: -20px; margin-top: -20px;">
    <div class="flex-auto mr-4"><a class="no-underline" href="/docs"><svg class="inline" xmlns="http://www.w3.org/2000/svg" width="102" height="22" viewBox="0 0 102 22" fill="none"><path d="M29.6006 4.30664L24.9824 15.8083H27.0328L27.9448 13.5064H32.8375L33.7338 15.8083H35.8324L31.222 4.30664H29.6006ZM28.6561 11.6698L30.3916 7.26636L32.1114 11.6698H28.6561Z" fill="#1E61F0"/><path d="M46.3273 7.61133C45.7724 7.61133 45.2618 7.7384 44.7934 7.99253C44.3251 8.24667 43.9778 8.59073 43.7515 9.02276C43.2724 8.08148 42.4381 7.61133 41.2486 7.61133C40.7695 7.61133 40.3081 7.71396 39.8643 7.9202C39.4206 8.12644 39.0615 8.45682 38.787 8.91036V7.77945H36.9541V15.8082H38.787V11.308C38.787 10.6668 38.9631 10.183 39.3153 9.85653C39.6676 9.53006 40.0916 9.36683 40.5865 9.36683C41.1355 9.36683 41.5684 9.53886 41.8862 9.8839C42.2039 10.2289 42.3623 10.703 42.3623 11.3071V15.8072H44.211V11.3071C44.211 10.6659 44.3861 10.182 44.7354 9.85555C45.0857 9.52908 45.5107 9.36585 46.0115 9.36585C46.5545 9.36585 46.9825 9.53788 47.2954 9.88292C47.6073 10.228 47.7637 10.702 47.7637 11.3061V15.8063H49.637V10.8975C49.637 9.89758 49.332 9.099 48.721 8.50276C48.11 7.90945 47.3121 7.61133 46.3273 7.61133Z" fill="#1E61F0"/><path d="M58.0913 8.17238C57.502 7.79802 56.8546 7.61133 56.1492 7.61133C55.5038 7.61133 54.9351 7.75013 54.4462 8.0287C53.9562 8.30727 53.5626 8.70509 53.2675 9.22412V7.78043H51.4346V18.6164H53.2675V14.3655C53.5636 14.8787 53.9562 15.2745 54.4462 15.5521C54.9361 15.8307 55.5038 15.9695 56.1492 15.9695C57.2206 15.9695 58.1297 15.5639 58.8784 14.7545C59.6261 13.9442 60 12.959 60 11.7987C60 11.0392 59.8288 10.3394 59.4874 9.6972C59.146 9.05502 58.6807 8.54675 58.0913 8.17238ZM57.4813 13.5181C57.0081 13.9911 56.4296 14.2277 55.7458 14.2277C55.0355 14.2277 54.4442 13.995 53.9739 13.5298C53.5026 13.0645 53.2675 12.4868 53.2675 11.7968C53.2675 11.0959 53.5026 10.5134 53.9739 10.0481C54.4452 9.58284 55.0355 9.35021 55.7458 9.35021C56.4296 9.35021 57.0081 9.58675 57.4813 10.0598C57.9556 10.5329 58.1917 11.1116 58.1917 11.7968C58.1927 12.4722 57.9556 13.045 57.4813 13.5181Z" fill="#1E61F0"/><path d="M63.287 4.30664H61.4541V15.8083H63.287V4.30664Z" fill="#1E61F0"/><path d="M66.9003 7.7793H65.0674V15.8081H66.9003V7.7793Z" fill="#1E61F0"/><path d="M65.996 4.04883C65.6733 4.04883 65.3959 4.16417 65.1647 4.39387C64.9335 4.62357 64.8174 4.89628 64.8174 5.21199C64.8174 5.53846 64.9325 5.81606 65.1647 6.04673C65.3959 6.27643 65.6733 6.39177 65.996 6.39177C66.3187 6.39177 66.5982 6.27643 66.8323 6.04673C67.0665 5.81703 67.1836 5.53846 67.1836 5.21199C67.1836 4.89628 67.0665 4.62357 66.8323 4.39387C66.5972 4.16417 66.3187 4.04883 65.996 4.04883Z" fill="#1E61F0"/><path d="M71.4538 5.62109H69.6051V7.77832H68.0713V9.51916H69.6051V12.7838C69.6051 13.7838 69.8737 14.554 70.4129 15.0936C70.951 15.6341 71.6751 15.9039 72.5842 15.9039C72.961 15.9039 73.2926 15.8716 73.5769 15.8071V14.1151C73.4107 14.1581 73.2109 14.1796 72.9797 14.1796C72.5055 14.1796 72.1336 14.0633 71.8621 13.8307C71.5905 13.5981 71.4538 13.2384 71.4538 12.7516V9.51916H73.5769V7.77832H71.4538V5.62109Z" fill="#1E61F0"/><path d="M80.6484 12.127C80.6484 12.7574 80.4673 13.2628 80.1033 13.643C79.7403 14.0223 79.2602 14.2129 78.662 14.2129C78.0697 14.2129 77.5935 14.0232 77.2324 13.643C76.8714 13.2638 76.6913 12.7584 76.6913 12.127V7.7793H74.8584V12.343C74.8584 13.471 75.1575 14.3575 75.7547 15.0017C76.3519 15.6458 77.1724 15.9684 78.2173 15.9684C78.7505 15.9684 79.2238 15.8452 79.638 15.5989C80.0522 15.3535 80.3886 15.0007 80.6474 14.5403V15.8081H82.496V7.7793H80.6474V12.127H80.6484Z" fill="#1E61F0"/><path d="M90.6406 9.19095C90.3445 8.68268 89.9549 8.29268 89.4699 8.01997C88.9858 7.74726 88.423 7.61139 87.7826 7.61139C87.0771 7.61139 86.4288 7.79613 85.8375 8.16463C85.2452 8.53313 84.7769 9.03847 84.4325 9.68065C84.0882 10.3228 83.916 11.0227 83.916 11.7822C83.916 12.5416 84.0882 13.2435 84.4325 13.8876C84.7769 14.5317 85.2452 15.04 85.8375 15.4114C86.4298 15.7829 87.0781 15.9686 87.7826 15.9686C88.423 15.9686 88.9858 15.8337 89.4699 15.5629C89.9539 15.2932 90.3445 14.9041 90.6406 14.3959V15.8073H92.4982V4.30664H90.6406V9.19095ZM89.9352 13.5269C89.464 13.9951 88.8786 14.2287 88.1791 14.2287C87.4953 14.2287 86.9168 13.9922 86.4435 13.5191C85.9693 13.046 85.7332 12.4674 85.7332 11.7822C85.7332 11.1087 85.9703 10.5349 86.4435 10.0619C86.9168 9.58877 87.4953 9.35223 88.1791 9.35223C88.8786 9.35223 89.464 9.58486 89.9352 10.0501C90.4065 10.5154 90.6416 11.0931 90.6416 11.7831C90.6406 12.4771 90.4055 13.0587 89.9352 13.5269Z" fill="#1E61F0"/><path d="M102 11.6218C102 10.8574 101.822 10.1664 101.466 9.54863C101.111 8.93088 100.633 8.45389 100.033 8.11667C99.4327 7.77945 98.7716 7.61133 98.0504 7.61133C97.286 7.61133 96.5854 7.79313 95.9469 8.15674C95.3094 8.52036 94.8057 9.01885 94.4367 9.65224C94.0678 10.2856 93.8838 10.9855 93.8838 11.7498C93.8838 12.5357 94.0678 13.2522 94.4367 13.8993C94.8057 14.5463 95.3104 15.0526 95.9509 15.4192C96.5914 15.7857 97.3017 15.9685 98.0829 15.9685C99.0785 15.9685 99.9256 15.7114 100.626 15.1983C101.326 14.6851 101.751 14.0058 101.902 13.1613H100.054C99.9729 13.5034 99.7535 13.782 99.3953 13.995C99.0372 14.2091 98.6112 14.3156 98.1153 14.3156C97.4749 14.3156 96.9505 14.1446 96.5412 13.8025C96.1319 13.4604 95.8682 12.9902 95.7502 12.3911H101.95C101.984 12.2474 102 11.9903 102 11.6218ZM95.7993 10.8271C95.9341 10.3345 96.189 9.95232 96.5668 9.67961C96.9436 9.4069 97.403 9.27006 97.9471 9.27006C98.4961 9.27006 98.9546 9.41374 99.3235 9.69916C99.6925 9.98555 99.9168 10.3609 99.9975 10.8262H95.7993V10.8271Z" fill="#1E61F0"/><path d="M9.3659 5.25304C9.30588 5.1768 9.24193 5.13477 9.16519 5.13477C9.1101 5.13868 9.05894 5.15627 9.01171 5.18559C8.44403 5.62642 7.6717 7.49628 7.03613 9.96336L7.59988 9.96727C8.70967 9.97998 9.85684 9.99269 10.9883 10.0093C10.6892 8.88133 10.4078 7.91463 10.1481 7.13072C9.76731 5.99101 9.51151 5.47785 9.3659 5.25304Z" fill="#1E61F0"/><path d="M10.6256 0.5C4.75792 0.5 0 5.22694 0 11.0564C0 16.886 4.75792 21.6129 10.6256 21.6129C16.4933 21.6129 21.2512 16.886 21.2512 11.0564C21.2512 5.22694 16.4933 0.5 10.6256 0.5ZM18.4689 10.9294C18.4394 11.0477 18.3666 11.163 18.2643 11.247C18.2515 11.2558 18.2387 11.2637 18.2259 11.2725L18.2131 11.2813L18.1875 11.2979L18.1659 11.3106C18.0852 11.3526 17.9947 11.3741 17.9012 11.3741H12.8659C12.9042 11.5393 12.9514 11.7299 12.9977 11.9342C13.2751 13.1169 14.0052 16.2623 14.7853 16.2623H14.8021H14.8109H14.8277C15.4337 16.2623 15.7456 15.3895 16.4284 13.4766L16.4372 13.4551C16.5484 13.1501 16.6724 12.8022 16.8042 12.4337L16.8386 12.3408C16.8898 12.2177 17.0305 12.1541 17.1545 12.2049C17.244 12.2392 17.3079 12.3281 17.3079 12.4259C17.3079 12.4513 17.304 12.4728 17.2991 12.4933L17.2696 12.5862C17.1968 12.8149 17.125 13.1247 17.0344 13.4854C16.6291 15.1559 16.0142 17.6787 14.444 17.6787H14.4312C13.4158 17.6699 12.8098 16.059 12.549 15.368C12.063 14.0787 11.696 12.7093 11.3419 11.379H6.71677L5.75653 14.4355L5.74374 14.4228C5.59911 14.6476 5.29608 14.715 5.0698 14.5714C4.92911 14.4824 4.84351 14.3299 4.84351 14.1647V14.1481L4.90353 13.8001C5.03536 13.0162 5.1977 12.1971 5.37676 11.3751H3.41397L3.40512 11.3663C3.0037 11.3067 2.72626 10.9343 2.78627 10.5355C2.8335 10.2256 3.07257 9.98028 3.37954 9.92456C3.45628 9.91576 3.53302 9.91185 3.60976 9.91576H3.70322C4.32207 9.92456 4.97928 9.93727 5.70438 9.94509C6.72464 5.82416 7.90625 3.72949 9.22067 3.72558C10.6286 3.72558 11.6744 6.90913 12.5107 10.0252L12.5146 10.0379C14.2305 10.0722 16.0653 10.123 17.8441 10.2501L17.9209 10.2588C17.9504 10.2588 17.976 10.2628 18.0065 10.2676H18.0153L18.0242 10.2716H18.0281C18.3321 10.3312 18.5328 10.6283 18.4689 10.9294Z" fill="#1E61F0"/></svg> <span class="hidden md:inline text-xs uppercase text-black-600 ml-2">documentation</span></a></div>
    <div id="algolia-search-header"></div>
</div>

        </div>
      </div>

    </div>
    <div class="top-12 left-0 right-0 fixed bg-white z-10">
      <div class="w-full overflow-scroll md:overflow-auto pt-5 pl-5">
        <div class="box-border">
          
<div class="box-border flex flex-row flex-nowrap items-center border-solid border-b border-black-200 h-12 px-4 justify-start"
    style="margin-left: -20px; margin-top: -20px;">
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative top-nav-active"><a class="no-underline font-normal text-amp-blue-500 font-medium " href="/docs/get-started">Get Started</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/data">Data</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/analytics">Analytics</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/amplitude-ai">Amplitude AI</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/session-replay">Session Replay</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/guides-and-surveys">Guides and Surveys</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/assistant">AI Assistant</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/experiment-home">Experiment</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/admin">Admin</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 inline w-max" x-data="{ open: false }"><button
                 @click="open = !open" class="font-normal -mb-[11px] text-[#111827]">Developers <svg class="inline fill-[#111827]" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none"><g id="icon-chevron-down"><path id="Vector" d="M10.25 10.6338L13.8837 7L15 8.11625L10.25 12.8663L5.5 8.11625L6.61625 7L10.25 10.6338Z" fill="#5A5E68"/></g></svg></button>
                <div x-cloak x-show="open" x-transition @click.outside="open = false" class="mt-4 py-2 right-4 sm:right-auto absolute border border-amp-gray-100 rounded flex flex-col shadow-lg top-4 bg-white w-48 p-4 font-normal z-20">
                    
                        <a class="no-underline pl-4 py-2 font-light hover:bg-amp-blue-950 hover:rounded" href="/docs/sdks">SDKs</a>
                    
                        <a class="no-underline pl-4 py-2 font-light hover:bg-amp-blue-950 hover:rounded" href="/docs/apis">APIs</a>
                    
                </div>
            </div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/partners">Partners</a></div>
        
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/faq">FAQ</a></div>
        
    
</div>


        </div>
      </div>

    </div>
    
      <div
        class="w-64 top-24 bg-white bottom-0 border-solid border-r border-black-200 -left-60 lg:left-0 lg:translate-x-0 lg:block z-10 fixed transition shadow overflow-visible lg:overflow-auto lg:overscroll-contain" :class="{ 'translate-x-[240px]': sidebarOpen }">
        <button @click="sidebarOpen = !sidebarOpen" class="absolute lg:hidden left-0 z-50 w-4 translate-x-[245px] translate-y-8" :class="{ 'rotate-180': sidebarOpen, 'translate-x-[250px]' : sidebarOpen }"><svg xmlns="http://www.w3.org/2000/svg" width="21" height="24" viewBox="0 0 21 24" fill="none"><rect x="0.5" y="0.5" width="20" height="23" rx="3.5" fill="white"/><rect x="0.5" y="0.5" width="20" height="23" rx="3.5" stroke="#DEDFE2"/><g clip-path="url(#clip0_671_1270)"><path d="M11.007 11.8L8.09998 8.893L8.99298 8L12.793 11.8L8.99298 15.6L8.09998 14.707L11.007 11.8Z" fill="#1E2024"/></g><defs><clipPath id="clip0_671_1270"><rect width="16" height="16" fill="white" transform="translate(2.5 4)"/></clipPath></defs></svg></button>
        <div class="h-full overflow-scroll overscroll-contain">
  
  <amp-side-nav current-uri="/docs/get-started/amplitude-quickstart" nav-title="get_started">
    
      
      
        
        <amp-nav-item 
          title="⚡️Amplitude Quickstart" 
          url="/docs/get-started/amplitude-quickstart" 
          slug="amplitude-quickstart"
          level="1"
          is-current>
        </amp-nav-item>

      
    
      
      
        
        <amp-nav-item 
          title="Set Up Amplitude" 
          slug="set-up-amplitude"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="What is Amplitude?" 
                  url="/docs/get-started/what-is-amplitude" 
                  slug="what-is-amplitude"
                  parent-slug="set-up-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Create a new account" 
                  url="/docs/get-started/create-a-new-account" 
                  slug="create-a-new-account"
                  parent-slug="set-up-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Create a project in Amplitude" 
                  url="/docs/get-started/create-project" 
                  slug="create-a-project-in-amplitude"
                  parent-slug="set-up-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Plan your implementation" 
                  url="/docs/get-started/plan-your-implementation" 
                  slug="plan-your-implementation"
                  parent-slug="set-up-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Instrumentation pre-work" 
                  url="/docs/get-started/instrumentation-prework" 
                  slug="instrumentation-pre-work"
                  parent-slug="set-up-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Instrument Amplitude" 
          slug="instrument-amplitude"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Get Data into Amplitude" 
                  slug="get-data-into-amplitude"
                  parent-slug="instrument-amplitude"
                  has-children
                  level="2">
                  
                    
                    <amp-nav-item 
                      title="SDK Catalog" 
                      url="/docs/sdks" 
                      slug="sdk-catalog"
                      parent-slug="get-data-into-amplitude"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Source Catalog" 
                      url="/docs/data/source-catalog" 
                      slug="source-catalog"
                      parent-slug="get-data-into-amplitude"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Use Autocapture to get fast insights" 
                  url="/docs/get-started/autocapture" 
                  slug="use-autocapture-to-get-fast-insights"
                  parent-slug="instrument-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="What events will you need?" 
                  url="/docs/get-started/select-events" 
                  slug="what-events-will-you-need"
                  parent-slug="instrument-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Track progress as you instrument Amplitude" 
                  url="/docs/get-started/track-your-progress" 
                  slug="track-progress-as-you-instrument-amplitude"
                  parent-slug="instrument-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Questions your engineer might ask you" 
                  url="/docs/get-started/engineer-questions" 
                  slug="questions-your-engineer-might-ask-you"
                  parent-slug="instrument-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Cross-platform instrumentation vs. separate platform instrumentation" 
                  url="/docs/get-started/cross-platform-vs-separate-platform" 
                  slug="cross-platform-instrumentation-vs-separate-platform-instrumentation"
                  parent-slug="instrument-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Build a Chart" 
          slug="build-a-chart"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="The Amplitude Home page" 
                  url="/docs/get-started/amplitude-home-page" 
                  slug="the-amplitude-home-page"
                  parent-slug="build-a-chart"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Create a chart" 
                  url="/docs/get-started/create-a-chart" 
                  slug="create-a-chart"
                  parent-slug="build-a-chart"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Spaces: Keep your work organized" 
                  url="/docs/get-started/spaces" 
                  slug="spaces-keep-your-work-organized"
                  parent-slug="build-a-chart"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Start from a template" 
                  url="/docs/get-started/start-from-template" 
                  slug="start-from-a-template"
                  parent-slug="build-a-chart"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Get Value from Amplitude" 
          slug="get-value-from-amplitude"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Understand your users' activity" 
                  url="/docs/get-started/understand-user-activity" 
                  slug="understand-your-users-activity"
                  parent-slug="get-value-from-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Analyze your acquisition channels" 
                  url="/docs/get-started/analyze-acquisition-channels" 
                  slug="analyze-your-acquisition-channels"
                  parent-slug="get-value-from-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Analyze the adoption of a feature" 
                  url="/docs/get-started/analyze-feature-adoption" 
                  slug="analyze-the-adoption-of-a-feature"
                  parent-slug="get-value-from-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Understand the conversion rate of an important flow" 
                  url="/docs/get-started/understand-conversion-rate" 
                  slug="understand-the-conversion-rate-of-an-important-flow"
                  parent-slug="get-value-from-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="How Amplitude identifies your users" 
                  url="/docs/get-started/identify-users" 
                  slug="how-amplitude-identifies-your-users"
                  parent-slug="get-value-from-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Additional Reading" 
          slug="additional-reading"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Helpful definitions" 
                  url="/docs/get-started/helpful-definitions" 
                  slug="helpful-definitions"
                  parent-slug="additional-reading"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="User property definitions" 
                  url="/docs/get-started/user-property-definitions" 
                  slug="user-property-definitions"
                  parent-slug="additional-reading"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Event property definitions" 
                  url="/docs/get-started/event-property-definitions" 
                  slug="event-property-definitions"
                  parent-slug="additional-reading"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Browser compatibility for Amplitude's product website" 
                  url="/docs/get-started/browser-compatibility" 
                  slug="browser-compatibility-for-amplitudes-product-website"
                  parent-slug="additional-reading"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="How to organize your team for implementation" 
                  url="/docs/get-started/implementationn-team-organization" 
                  slug="how-to-organize-your-team-for-implementation"
                  parent-slug="additional-reading"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Optimize your Amplitude workflow to improve user engagement" 
                  url="/docs/get-started/optimize-amplitude-workflow" 
                  slug="optimize-your-amplitude-workflow-to-improve-user-engagement"
                  parent-slug="additional-reading"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Analyze A/B test results in Amplitude" 
                  url="/docs/get-started/analyze-a-b-test-results" 
                  slug="analyze-ab-test-results-in-amplitude"
                  parent-slug="additional-reading"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Migrate to Amplitude" 
          slug="migrate-to-amplitude"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Migrate From Adobe" 
                  url="/docs/migration/migrate-from-adobe" 
                  slug="migrate-from-adobe"
                  parent-slug="migrate-to-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Migrate From Mixpanel" 
                  url="/docs/migration/migrate-from-mixpanel" 
                  slug="migrate-from-mixpanel"
                  parent-slug="migrate-to-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Migrate From mParticle" 
                  url="/docs/migration/migrate-from-mparticle" 
                  slug="migrate-from-mparticle"
                  parent-slug="migrate-to-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Migrate From Segment" 
                  url="/docs/migration/migrate-from-segment" 
                  slug="migrate-from-segment"
                  parent-slug="migrate-to-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Migrate from Google Analytics" 
                  url="/docs/migration/migrate-from-google-analytics" 
                  slug="migrate-from-google-analytics"
                  parent-slug="migrate-to-amplitude"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
  </amp-side-nav>

</div>    
        
      </div>
      <div class="absolute top-24 left-0 lg:left-64 bottom-0 right-0 z-0 transition">
        <div class="max-w-screen-xl pt-8 mx-auto">
          <section class="w-full flex flex-col items-center">
  <div class="flex flex-row flex-nowrap w-full text-sm pl-6 lg:pl-8 text-gray-400">
    
    <div class="mr-2 text-s text-gray-500 "><a class=""
        href="/docs/get-started">Get Started</a></div>
    <span class="mr-2">/</span><div class="mr-2 text-s text-gray-500 "><a class="font-semibold"
        href="/docs/get-started/amplitude-quickstart">Amplitude Quickstart</a></div>
    
    
</div>
  <div class="flex flex-row w-full pt-8 px-6 lg:p-8">
    <div class="copy w-full">
      <div class="flex flex-row items-start justify-between">
        <h1 class="font-[Gellix] font-normal mb-5 max-w-3xl">Amplitude Quickstart</h1>
        </div>
      <div
        class="prose prose-a:text-amp-blue prose-ol:list-decimal prose-ol:list-outside prose-pre:bg-[#fafafa] max-w-prose" data-headings-anchors data-math-root>
        
        


        


        
        <p>Get started with the full Amplitude platform in minutes. Which features drive retention? Where do users drop off? What's working and what's not? Traditional analytics implementations can take weeks or months. Amplitude's modern approach gets you from zero to insights in minutes, not months.</p>
<p>Use this kit to get Autocapture, Session Replay, Web Experiment, and Guides &amp; Surveys.</p>
<h2 id="speed-run-your-installation-browser-sdk-and-autocapture">Speed run your installation: Browser SDK and Autocapture<a href="#speed-run-your-installation-browser-sdk-and-autocapture" class="heading-permalink" aria-hidden="true" title="Permalink"></a></h2>
<p>Quickly get data flowing into Amplitude with Browser SDK and <a href="/docs/data/autocapture">Autocapture</a>.</p>
<h3 id="install-amplitude">Install Amplitude<a href="#install-amplitude" class="heading-permalink" aria-hidden="true" title="Permalink"></a></h3>
<p>Need an API key? Create a <a href="https://app.amplitude.com/signup">free Amplitude account</a> to get started.</p>
<p>When you create your Amplitude account, Amplitude provides two ways to install:</p>
<ul>
<li>A prompt which you can pass to your agentic AI tool of choice.</li>
<li>A pre-configured snippet, which you can add inside the <code>&lt;head&gt;</code> tag of every page you want to track.</li>
</ul>
<p>
<div class="hint tip"><h2 class="hint-title">Get your data flowing!</h2><div class="hint-content"><div class="quickstart-configurator">
    
    <p class="text-sm text-amp-gray-600 my-0">Customize your installation by selecting the features and data region for your project.</p>
    
    <div class="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8 py-3">
        
        <div class="flex items-center gap-6">
            <label class="flex items-center gap-2 cursor-pointer group">
                <input type="checkbox" id="quickstart-autocapture" checked class="cursor-pointer w-4 h-4 rounded border-amp-gray-300 text-amp-blue focus:ring-amp-blue-500">
                <span class="text-sm text-amp-gray-700 group-hover:text-amp-gray-900">Autocapture</span>
            </label>
            <label class="flex items-center gap-2 cursor-pointer group">
                <input type="checkbox" id="quickstart-session-replay" checked class="cursor-pointer w-4 h-4 rounded border-amp-gray-300 text-amp-blue focus:ring-amp-blue-500">
                <span class="text-sm text-amp-gray-700 group-hover:text-amp-gray-900">Session Replay</span>
            </label>
        </div>

        
        <div class="hidden sm:block w-px h-6 bg-amp-gray-200"></div>

        
        <div class="flex items-center gap-3">
            <span class="text-sm text-amp-gray-700">Data region</span>
            <div class="flex rounded-md overflow-hidden border border-amp-gray-200 shadow-sm">
                <button type="button" id="quickstart-region-us" class="px-3 py-1.5 text-sm font-semibold bg-amp-blue-950 text-amp-blue-500 transition-colors">US</button>
                <button type="button" id="quickstart-region-eu" class="px-3 py-1.5 text-sm font-medium bg-white text-amp-gray-300 hover:text-amp-gray-500 hover:bg-amp-gray-50 transition-colors">EU</button>
            </div>
        </div>
    </div>
</div>

<style>
/* Fix API key button positioning in quickstart component - keep button visible during horizontal scroll */
pre:has(#quickstart-ai-prompt) .api-key-manual-button,
pre:has(#quickstart-snippet) .api-key-manual-button {
    position: absolute !important;
    right: 3rem !important;
    will-change: transform !important;
    transition: none !important;
}
</style>


<div class="border border-amp-gray-200 rounded" x-data="{ activeTab: 'AI Prompt' }">
<div class="flex space-x-1 border-amp-gray-200 border-b border-solid">
<button x-on:click="activeTab = 'AI Prompt'" :class="{'border-b-2 border-amp-blue-500 text-amp-blue-500 -mb-[2px]' : activeTab === 'AI Prompt', 'bg-gray-200': activeTab !== 'AI Prompt'}" class="px-4  py-2">AI Prompt</button><button x-on:click="activeTab = 'Snippet'" :class="{'border-b-2 border-amp-blue-500 text-amp-blue-500 -mb-[2px]' : activeTab === 'Snippet', 'bg-gray-200': activeTab !== 'Snippet'}" class="px-4  py-2">Snippet</button></div>
<div x-cloak x-show="activeTab === 'AI Prompt'" class="p-4 tab"><p>Paste the prompt below into your terminal or AI tools like Copilot, Cursor, Replit or Bolt.</p>
<p>Click the Key icon to insert your Amplitude API key.</p>
<pre><code class="language-plaintext" id="quickstart-ai-prompt">__AI_PROMPT_PLACEHOLDER__</code></pre>
</div>
<div x-cloak x-show="activeTab === 'Snippet'" class="p-4 tab"><p>Paste this snippet into the <code>&lt;head&gt;</code>of your site to track engagement.</p>
<p>Click the Key icon to insert your Amplitude API key.</p>
<pre><code class="language-html" id="quickstart-snippet">&lt;script src="https://cdn.amplitude.com/script/AMPLITUDE_API_KEY.js"&gt;&lt;/script&gt;&lt;script&gt;window.amplitude.add(window.sessionReplay.plugin({sampleRate: 1}));window.amplitude.init('AMPLITUDE_API_KEY', {"fetchRemoteConfig":true,"autocapture":{"attribution":true,"fileDownloads":true,"formInteractions":true,"pageViews":true,"sessions":true,"elementInteractions":true,"networkTracking":true,"webVitals":true,"frustrationInteractions":true}});&lt;/script&gt;</code></pre>
</div>
</div>

<script>
(function() {
    const autocaptureCheckbox = document.getElementById('quickstart-autocapture');
    const sessionReplayCheckbox = document.getElementById('quickstart-session-replay');
    const regionUsButton = document.getElementById('quickstart-region-us');
    const regionEuButton = document.getElementById('quickstart-region-eu');
    const aiPromptCode = document.getElementById('quickstart-ai-prompt');
    const snippetCode = document.getElementById('quickstart-snippet');
    
    // Configuration - matching production code
    const isUnifiedSdkEnabled = true;
    let isEUDC = false;
    
    function makeAiPrompt({ isAutocaptureSelected, isSessionReplaySelected, apiKey }) {
        const autoCapture = { autocapture: isAutocaptureSelected };
        const serverZone = isEUDC ? { serverZone: 'EU' } : {};
        const analyticsInitOptions = JSON.stringify({
            ...autoCapture,
            ...serverZone,
        });
        const unifiedInitOptions = JSON.stringify({
            ...serverZone,
            analytics: {
                ...autoCapture,
            },
            ...(isSessionReplaySelected ? { sessionReplay: { sampleRate: 1 } } : {}),
        });
        
        const includeSessionReplaySpecificSteps = !isUnifiedSdkEnabled && isSessionReplaySelected;
        
        const documentationSteps = [
            `Install the Amplitude Analytics Browser SDK with \`npm install @amplitude/unified\` or \`yarn add @amplitude/unified\``,
            ...(includeSessionReplaySpecificSteps
                ? ['Install the Amplitude Session Replay SDK with `npm install @amplitude/plugin-session-replay-browser --save` or `yarn add @amplitude/plugin-session-replay-browser`']
                : []),
            `Import amplitude into the root of the client application with \`import * as amplitude from '@amplitude/unified';\``,
            ...(includeSessionReplaySpecificSteps
                ? [
                    "Import sessionReplayPlugin into the root of the client application with `import { sessionReplayPlugin } from '@amplitude/plugin-session-replay-browser';`",
                    'Add Session Replay to the Amplitude instance with `amplitude.add(sessionReplayPlugin({sampleRate: 1}));`',
                ]
                : []),
            `Initialize amplitude with \`amplitude.initAll('${apiKey}', ${unifiedInitOptions});\``,
            ...(isAutocaptureSelected
                ? []
                : [`Track the initialization of amplitude with the following line of code that should fire when amplitude is initialized. Make sure you include the comment with the code. \`amplitude.track('amplitude initialized'); // you must send an event to advance through Amplitude onboarding. As you've disabled autocapture, we've added this initilization event. Of course, you can also add more and replace this one! See our documentation for more details (https://amplitude.com/docs/sdks/analytics/browser/browser-sdk-2#track-an-event).\``]),
        ];
        
        const documentationText = documentationSteps
            .map((step, index) => `${index + 1}. ${step}`)
            .join('\n');
        
        return `You are an Amplitude Analytics installation wizard, an expert AI programming assistant that implements Amplitude Analytics${isSessionReplaySelected ? ' and Session Replay ' : ' '}for JavaScript-based applications.

Your task is to select, install, and initialize the correct Amplitude package(s) necessary to enable Amplitude Analytics${isSessionReplaySelected ? ' and Session Replay ' : ' '}for this application and track key interactions, all in strict accordance to the Documentation provided below.

Rules
- Do not make any code changes if this is not a JavaScript-based application
- Ensure ALL the code added ONLY runs client-side and never server-side
- Ensure amplitude is only initialized once during the lifecycle of the application

Context
---

## Documentation
${documentationText}`;
    }
    
    function updateSnippets() {
        const isAutocaptureSelected = autocaptureCheckbox.checked;
        const isSessionReplaySelected = sessionReplayCheckbox.checked;
        
        // Always use placeholder - let global API key system handle replacement
        const apiKey = 'AMPLITUDE_API_KEY';
        
        // Generate AI Prompt using production logic
        const updatedAiPrompt = makeAiPrompt({
            isAutocaptureSelected,
            isSessionReplaySelected,
            apiKey
        });
        aiPromptCode.textContent = updatedAiPrompt;
        
        // Build Snippet (HTML snippet tab)
        let snippetParts = [];
        // Use actual < and > characters, escape for template literal safety
        const scriptOpen = String.fromCharCode(60) + 'script';
        const scriptClose = String.fromCharCode(60) + '/script' + String.fromCharCode(62);
        
        const cdnDomain = isEUDC ? 'cdn.eu.amplitude.com' : 'cdn.amplitude.com';
        snippetParts.push(`${scriptOpen} src="https://${cdnDomain}/script/${apiKey}.js"${String.fromCharCode(62)}${scriptClose}`);
        
        let scriptContent = [];
        if (isSessionReplaySelected) {
            scriptContent.push('window.amplitude.add(window.sessionReplay.plugin({sampleRate: 1}));');
        }
        
        // Build init config for snippet
        let snippetInitConfig = {
            fetchRemoteConfig: true
        };
        
        if (isEUDC) {
            snippetInitConfig.serverZone = 'EU';
        }
        
        if (isAutocaptureSelected) {
            snippetInitConfig.autocapture = {
                attribution: true,
                fileDownloads: true,
                formInteractions: true,
                pageViews: true,
                sessions: true,
                elementInteractions: true,
                networkTracking: true,
                webVitals: true,
                frustrationInteractions: true
            };
        } else {
            snippetInitConfig.autocapture = {
                attribution: false,
                fileDownloads: false,
                formInteractions: false,
                pageViews: false,
                sessions: false,
                elementInteractions: false,
                networkTracking: false,
                webVitals: false,
                frustrationInteractions: false
            };
        }
        
        scriptContent.push(`window.amplitude.init('${apiKey}', ${JSON.stringify(snippetInitConfig)});`);
        
        snippetParts.push(scriptOpen + String.fromCharCode(62) + scriptContent.join('') + scriptClose);
        
        const updatedSnippet = snippetParts.join('');
        snippetCode.textContent = updatedSnippet;
        
        // Store original content with placeholder for global API key system
        aiPromptCode.setAttribute('data-original-content', updatedAiPrompt);
        snippetCode.setAttribute('data-original-content', updatedSnippet);
        
        // Re-highlight with Prism
        if (window.Prism) {
            Prism.highlightElement(aiPromptCode);
            Prism.highlightElement(snippetCode);
        }
        
        // Trigger API key button addition and replacement from global system
        if (window.amplitudeApiKeyFeature) {
            // Small delay to ensure Prism highlighting is complete
            setTimeout(() => {
                // Add buttons to code blocks with AMPLITUDE_API_KEY
                if (window.amplitudeApiKeyFeature.addButtons) {
                    window.amplitudeApiKeyFeature.addButtons();
                }
                // Apply stored API key if exists
                if (window.amplitudeApiKeyFeature.updateBlocks) {
                    const storedApiKey = localStorage.getItem('amplitude_api_key');
                    if (storedApiKey) {
                        window.amplitudeApiKeyFeature.updateBlocks(storedApiKey);
                    }
                }
                
                // Fix button positioning to not scroll horizontally
                fixApiKeyButtonPosition();
            }, 100);
        }
    }
    
    function fixApiKeyButtonPosition() {
        // Get both pre containers
        const preElements = [
            aiPromptCode.closest('pre'),
            snippetCode.closest('pre')
        ].filter(Boolean);
        
        preElements.forEach(pre => {
            const button = pre.querySelector('.api-key-manual-button');
            if (button && pre) {
                // Remove any existing scroll handler to prevent duplicates
                if (pre._scrollHandler) {
                    pre.removeEventListener('scroll', pre._scrollHandler);
                }
                
                // Create and store the scroll handler
                pre._scrollHandler = () => {
                    button.style.transform = `translateX(${pre.scrollLeft}px)`;
                };
                
                // Listen to scroll events and adjust button position
                pre.addEventListener('scroll', pre._scrollHandler);
                
                // Set initial position
                button.style.transform = `translateX(${pre.scrollLeft}px)`;
            }
        });
    }
    
    // Add event listeners
    autocaptureCheckbox.addEventListener('change', updateSnippets);
    sessionReplayCheckbox.addEventListener('change', updateSnippets);
    
    // Region toggle handlers
    function setRegion(isEU) {
        isEUDC = isEU;
        if (isEU) {
            regionUsButton.classList.remove('bg-amp-blue-950', 'text-amp-blue-500', 'font-semibold');
            regionUsButton.classList.add('bg-white', 'text-amp-gray-300', 'font-medium', 'hover:text-amp-gray-500', 'hover:bg-amp-gray-50');
            regionEuButton.classList.remove('bg-white', 'text-amp-gray-300', 'font-medium', 'hover:text-amp-gray-500', 'hover:bg-amp-gray-50');
            regionEuButton.classList.add('bg-amp-blue-950', 'text-amp-blue-500', 'font-semibold');
        } else {
            regionEuButton.classList.remove('bg-amp-blue-950', 'text-amp-blue-500', 'font-semibold');
            regionEuButton.classList.add('bg-white', 'text-amp-gray-300', 'font-medium', 'hover:text-amp-gray-500', 'hover:bg-amp-gray-50');
            regionUsButton.classList.remove('bg-white', 'text-amp-gray-300', 'font-medium', 'hover:text-amp-gray-500', 'hover:bg-amp-gray-50');
            regionUsButton.classList.add('bg-amp-blue-950', 'text-amp-blue-500', 'font-semibold');
        }
        updateSnippets();
    }
    
    regionUsButton.addEventListener('click', () => setRegion(false));
    regionEuButton.addEventListener('click', () => setRegion(true));
    
    // Initial update
    updateSnippets();
    
    // Listen for API key updates from the global system
    window.addEventListener('storage', function(e) {
        if (e.key === 'amplitude_api_key') {
            updateSnippets();
        }
    });
})();
</script></div></div>
</p>
<h3 id="use-autocapture">Use Autocapture<a href="#use-autocapture" class="heading-permalink" aria-hidden="true" title="Permalink"></a></h3>
<p>With <code>autocapture: true</code>, Amplitude automatically tracks:</p>
<ul>
<li><strong>Sessions</strong> – How users engage over time.</li>
<li><strong>Page views</strong> – Which pages matter most.</li>
<li><strong>Clicks &amp; interactions</strong> – What users engage with.</li>
<li><strong>Form interactions</strong> – Where users get stuck.</li>
<li><strong>File downloads</strong> – Content engagement.</li>
<li><strong>Marketing attribution</strong> – Where users come from.</li>
</ul>
<h2 id="take-the-next-step">Take the next step<a href="#take-the-next-step" class="heading-permalink" aria-hidden="true" title="Permalink"></a></h2>
<p>After your data starts flowing into Amplitude, expand  your implementation with Session Replay, Web Experiment, and Guides &amp; Surveys.</p>
<h3 id="add-session-replay">Add Session Replay<a href="#add-session-replay" class="heading-permalink" aria-hidden="true" title="Permalink"></a></h3>
<p>The snippet above includes <a href="/docs/session-replay/session-replay-plugin">Session Replay</a> at 100% sampling (<code>sampleRate: 1</code>). This lets you watch exactly what users experience and helps you debug issues and understand user behavior. Lower the sample rate in production to control volume and cost.</p>
<h3 id="launch-a-web-experiment">Launch a Web Experiment<a href="#launch-a-web-experiment" class="heading-permalink" aria-hidden="true" title="Permalink"></a></h3>
<p>Web Experiment lets you run A/B tests on your website using the same data you already send through the Unified Browser SDK. Target users, roll out changes gradually, and compare variants based on real product metrics like activation or retention in Amplitude. Web Experiment handles experiment assignment, exposure, and basic statistical analysis so you don't need to build that logic yourself.</p>
<p>Test different versions or features of your site using Amplitude's no-code <a href="/docs/web-experiment/set-up-a-web-experiment#the-visual-editor">Visual Editor</a>.</p>
<h3 id="create-a-guide-or-survey">Create a guide or survey<a href="#create-a-guide-or-survey" class="heading-permalink" aria-hidden="true" title="Permalink"></a></h3>
<p><a href="/docs/guides-and-surveys">Guides &amp; Surveys</a> let you deliver in-product messages and collect feedback on your website using the same Unified Browser SDK instrumentation you already set up. You can target users based on their behavior or properties, show walkthroughs or prompts, and trigger surveys at key moments in the journey. Amplitude captures responses and interactions, so you can see how they relate to core metrics like activation, conversion, or retention. This is a natural next step after events are flowing and you want to both influence and understand user behavior directly in the product.</p>
<h2 id="benefits-of-this-approach">Benefits of this approach<a href="#benefits-of-this-approach" class="heading-permalink" aria-hidden="true" title="Permalink"></a></h2>
<ul>
<li><strong>Time to insight</strong>: Think minutes, not months. Start analyzing user behavior the same day.</li>
<li><strong>No engineering bottleneck</strong>: Non-technical team members can define events using Visual Labeling.</li>
<li><strong>Flexible foundation</strong>: Add custom precision tracking later as needs emerge.</li>
<li><strong>Complete picture</strong>: Autocapture + Session Replay shows what users do and why.</li>
<li><strong>Cost-effective</strong>: Only pay for what you use; scale as you grow.</li>
</ul>

        
      </div>
      </div>

    
      

<div class="relative basis-64 shrink-0 hidden lg:block">
  <div class="flex flex-row ml-8 mb-2">
    

<div class="copy-page-menu relative" data-md-url="/docs/md/get-started/amplitude-quickstart.md">
    <button class="copy-page-toggle group flex items-center font-medium border border-white hover:border-amp-gray-200 rounded-md transition-all duration-200"
        aria-label="Copy page options" title="Copy page options">
        <div class="flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor" class="w-6 h-6 text-amp-gray-500 transition-transform duration-200 group-hover:-translate-y-px">                <path d="M362.31-260Q332-260 311-281q-21-21-21-51.31v-455.38Q290-818 311-839q21-21 51.31-21h335.38Q728-860 749-839q21 21 21 51.31v455.38Q770-302 749-281q-21 21-51.31 21H362.31Zm0-60h335.38q4.62 0 8.46-3.85 3.85-3.84 3.85-8.46v-455.38q0-4.62-3.85-8.46-3.84-3.85-8.46-3.85H362.31q-4.62 0-8.46 3.85-3.85 3.84-3.85 8.46v455.38q0 4.62 3.85 8.46 3.84 3.85 8.46 3.85Zm-140 200Q192-120 171-141q-21-21-21-51.31v-515.38h60v515.38q0 4.62 3.85 8.46 3.84 3.85 8.46 3.85h395.38v60H222.31ZM350-320v-480 480Z" />
            </svg>
        </div>
    </button>

    <!-- Dropdown Menu -->
    <div class="copy-page-dropdown hidden absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg border border-amp-gray-200 z-50 opacity-0 scale-95 transition-all duration-100 ease-out">
        <div class="py-1">
            <button class="copy-markdown-btn flex items-center w-full px-4 py-2 text-sm text-amp-gray-700 hover:bg-amp-gray-50 hover:text-amp-gray-900 transition-colors duration-150">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy as Markdown
            </button>
            
            <a href="/docs/md/get-started/amplitude-quickstart.md" target="_blank" class="copy-page-link flex items-center w-full px-4 py-2 text-sm text-amp-gray-700 hover:bg-amp-gray-50 hover:text-amp-gray-900 transition-colors duration-150">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View as Markdown
            </a>
            
            <hr class="my-1 border-amp-gray-100">
            
            <a href="https://chat.openai.com/?q=Look+at+this+document+from+Amplitude+so+I+can+ask+questions+about+it%3A+https%3A//amplitude.com/docs/md/get-started/amplitude-quickstart.md" target="_blank" class="open-chatgpt copy-page-link flex items-center w-full px-4 py-2 text-sm text-amp-gray-700 hover:bg-amp-gray-50 hover:text-amp-gray-900 transition-colors duration-150">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" viewBox="0 0 320 320">
                    <path d="m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z"/>
                    </svg>
                Open in ChatGPT
            </a>
            
            <a href="https://claude.ai/chat?q=Look+at+this+document+from+Amplitude+so+I+can+ask+questions+about+it%3A+https%3A//amplitude.com/docs/md/get-started/amplitude-quickstart.md" target="_blank" class="open-claude copy-page-link flex items-center w-full px-4 py-2 text-sm text-amp-gray-700 hover:bg-amp-gray-50 hover:text-amp-gray-900 transition-colors duration-150">
                <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" class="h-4 w-4 mr-3" viewBox="0 0 256 256" xml:space="preserve">
                    <g style="stroke: none; stroke-width: 0; stroke-dasharray: none; stroke-linecap: butt; stroke-linejoin: miter; stroke-miterlimit: 10; fill: none; fill-rule: nonzero; opacity: 1;" transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
                        <path d="M 17.671 59.85 l 17.699 -9.93 l 0.298 -0.862 l -0.298 -0.48 h -0.862 l -2.958 -0.182 l -10.113 -0.273 l -8.77 -0.364 L 4.17 47.302 l -2.138 -0.456 l -2.004 -2.642 l 0.207 -1.318 l 1.798 -1.209 l 2.575 0.225 l 5.691 0.389 l 8.54 0.589 l 6.195 0.364 l 9.177 0.954 h 1.458 l 0.207 -0.589 l -0.498 -0.364 l -0.389 -0.364 l -8.837 -5.989 l -9.566 -6.329 l -5.011 -3.644 l -2.709 -1.846 l -1.367 -1.731 l -0.589 -3.778 l 2.46 -2.709 l 3.304 0.225 l 0.844 0.225 l 3.347 2.575 l 7.149 5.533 l 9.335 6.875 l 1.367 1.136 l 0.547 -0.389 l 0.067 -0.273 l -0.613 -1.026 l -5.078 -9.177 l -5.418 -9.335 l -2.411 -3.869 l -0.638 -2.32 C 20.945 6.08 20.781 5.278 20.781 4.3 l 2.8 -3.802 L 25.13 0 l 3.735 0.498 l 1.573 1.367 l 2.32 5.308 l 3.76 8.357 l 5.831 11.364 l 1.707 3.371 l 0.911 3.122 l 0.34 0.954 h 0.589 v -0.547 l 0.48 -6.402 l 0.887 -7.859 L 48.125 9.42 l 0.298 -2.849 l 1.409 -3.413 l 2.8 -1.846 l 2.187 1.045 l 1.798 2.575 l -0.249 1.664 l -1.069 6.948 l -2.095 10.884 l -1.367 7.288 h 0.796 l 0.911 -0.911 l 3.687 -4.895 l 6.195 -7.744 l 2.733 -3.073 l 3.189 -3.395 l 2.047 -1.616 h 3.869 l 2.849 4.233 l -1.275 4.373 l -3.984 5.053 l -3.304 4.282 l -4.737 6.377 l -2.958 5.102 l 0.273 0.407 l 0.705 -0.067 l 10.702 -2.278 l 5.782 -1.045 l 6.9 -1.184 l 3.122 1.458 l 0.34 1.482 l -1.227 3.031 l -7.38 1.822 l -8.655 1.731 l -12.888 3.049 l -0.158 0.115 l 0.182 0.225 l 5.806 0.547 l 2.484 0.134 h 6.08 l 11.321 0.844 l 2.958 1.956 l 1.774 2.393 l -0.298 1.822 l -4.555 2.32 l -6.147 -1.458 l -14.346 -3.413 l -4.92 -1.227 h -0.68 v 0.407 l 4.1 4.009 l 7.513 6.784 l 9.408 8.746 l 0.48 2.162 l -1.209 1.707 L 78.044 75.8 l -8.266 -6.219 l -3.189 -2.8 l -7.222 -6.08 h -0.48 v 0.638 l 1.664 2.436 l 8.789 13.21 l 0.456 4.051 l -0.638 1.318 l -2.278 0.796 l -2.502 -0.456 l -5.144 -7.222 l -5.308 -8.133 l -4.282 -7.288 l -0.522 0.298 l -2.527 27.216 l -1.184 1.391 L 42.677 90 l -2.278 -1.731 l -1.209 -2.8 l 1.209 -5.533 l 1.458 -7.222 l 1.184 -5.74 l 1.069 -7.131 l 0.638 -2.369 l -0.043 -0.158 l -0.522 0.067 l -5.375 7.38 l -8.175 11.048 l -6.468 6.924 l -1.549 0.613 l -2.685 -1.391 l 0.249 -2.484 l 1.5 -2.211 l 8.953 -11.388 l 5.4 -7.058 l 3.486 -4.075 l -0.024 -0.589 h -0.207 L 15.509 69.592 l -4.233 0.547 l -1.822 -1.707 l 0.225 -2.8 l 0.862 -0.911 l 7.149 -4.92 l -0.024 0.024 L 17.671 59.85 z" style="stroke: none; stroke-width: 1; stroke-dasharray: none; stroke-linecap: butt; stroke-linejoin: miter; stroke-miterlimit: 10; fill: rgb(0,0,0); fill-rule: nonzero; opacity: 1;" transform=" matrix(1 0 0 1 0 0) " stroke-linecap="round"/>
                    </g>
                    </svg>
                Open in Claude
            </a>
        </div>
    </div>

</div>

<style>
/* Custom Tippy.js themes for success and error states */
.tippy-box[data-theme~='light-success'] {
    background-color: #dcfce7;
    color: #166534;
    border: 1px solid #bbf7d0;
}

.tippy-box[data-theme~='light-success'] .tippy-arrow {
    color: #dcfce7;
}

.tippy-box[data-theme~='light-error'] {
    background-color: #fef2f2;
    color: #dc2626;
    border: 1px solid #fecaca;
}

.tippy-box[data-theme~='light-error'] .tippy-arrow {
    color: #fef2f2;
}
</style>

<script>
(function() {
    'use strict';
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCopyPageMenu);
    } else {
        initCopyPageMenu();
    }
    
    function initCopyPageMenu() {
        const menus = document.querySelectorAll('.copy-page-menu');
        menus.forEach(menu => {
            const toggle = menu.querySelector('.copy-page-toggle');
            const dropdown = menu.querySelector('.copy-page-dropdown');
            const arrow = menu.querySelector('.copy-page-arrow');
            const copyBtn = menu.querySelector('.copy-markdown-btn');
            const links = menu.querySelectorAll('.copy-page-link');
            const mdUrl = menu.dataset.mdUrl;
            
            let isOpen = false;
            let copyTooltip = null;
            
            // Initialize Tippy.js tooltip for copy button
            if (window.tippy && copyBtn) {
                copyTooltip = tippy(copyBtn, {
                    content: 'Copy as Markdown',
                    placement: 'top',
                    trigger: 'manual',
                    theme: 'light',
                    animation: 'fade',
                    duration: [200, 150],
                    hideOnClick: false
                });
            }
            
            // Toggle dropdown
            toggle.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleDropdown();
            });
            
            // Close on outside click
            document.addEventListener('click', (e) => {
                if (isOpen && !menu.contains(e.target)) {
                    closeDropdown();
                }
            });
            
            // Close dropdown when links are clicked
            links.forEach(link => {
                link.addEventListener('click', () => {
                    closeDropdown();
                });
            });
            
            // Copy markdown functionality
            copyBtn.addEventListener('click', async () => {
                try {
                    const resp = await fetch(mdUrl);
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const raw = await resp.text();
                    
                    // Strip YAML front matter
                    const md = raw.replace(/^---[\r\n]+[\s\S]*?[\r\n]+---[\r\n]*/, '');
                    
                    if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(md);
                    } else {
                        // Fallback for older browsers
                        const ta = document.createElement('textarea');
                        ta.value = md;
                        ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;padding:0;border:none;outline:none;box-shadow:none;background:transparent;';
                        document.body.appendChild(ta);
                        ta.focus();
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                    }
                    
                    showTooltip('✓ Copied to clipboard!', 'success');
                } catch (err) {
                    showTooltip('✗ Copy failed: ' + err.message, 'error');
                }
            });
            
            function toggleDropdown() {
                isOpen ? closeDropdown() : openDropdown();
            }
            
            function openDropdown() {
                isOpen = true;
                dropdown.classList.remove('hidden');
                // Force reflow before adding animation classes
                dropdown.offsetHeight;
                dropdown.classList.remove('opacity-0', 'scale-95');
                dropdown.classList.add('opacity-100', 'scale-100');
                if (arrow) arrow.style.transform = 'rotate(180deg)';
            }
            
            function closeDropdown() {
                if (!isOpen) return;
                isOpen = false;
                dropdown.classList.remove('opacity-100', 'scale-100');
                dropdown.classList.add('opacity-0', 'scale-95');
                if (arrow) arrow.style.transform = '';
                // Hide after animation
                setTimeout(() => {
                    if (!isOpen) dropdown.classList.add('hidden');
                }, 100);
            }
            
            function showTooltip(message, type = 'success') {
                closeDropdown();
                
                if (copyTooltip) {
                    // Update tooltip content and styling based on type
                    copyTooltip.setContent(message);
                    
                    // Set theme based on success/error
                    const theme = type === 'success' ? 'light-success' : 'light-error';
                    copyTooltip.setProps({ theme: theme });
                    
                    // Show tooltip
                    copyTooltip.show();
                    
                    // Hide after 2 seconds
                    setTimeout(() => {
                        if (copyTooltip) {
                            copyTooltip.hide();
                            // Reset to default content and theme
                            setTimeout(() => {
                                if (copyTooltip) {
                                    copyTooltip.setContent('Copy as Markdown');
                                    copyTooltip.setProps({ theme: 'light' });
                                }
                            }, 200);
                        }
                    }, 2000);
                }
            }
        });
    }
})();
</script>


    
</div>
  

  <div class="sticky top-24 ml-8 text-sm js-toc">
  </div>

</div>

    
  </div>
  </div>
  
<div class="mt-12 mb-5 max-w-screen-xl mx-auto pl-8">
    <div class="inline-flex items-center">
    <span class="text-sm text-amp-gray-600 mr-4">Was this page helpful?</span>
    <div class="inline-flex flex-row-reverse items-center">
            <button @click="amplitude.track('Article rating')" class="article-rating inline-flex flex-row-reverse items-center">
            
            <svg xmlns="http://www.w3.org/2000/svg"
                class="inline cursor-pointer"
                height="24px" viewBox="0 -960 960 960" width="24px" fill="#e8eaed">
                <path
                    d="m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Zm247-350Z">
                </path>
            </svg>
            
            <svg xmlns="http://www.w3.org/2000/svg"
                class="inline cursor-pointer"
                height="24px" viewBox="0 -960 960 960" width="24px" fill="#e8eaed">
                <path
                    d="m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Zm247-350Z">
                </path>
            </svg>
            
            <svg xmlns="http://www.w3.org/2000/svg"
                class="inline cursor-pointer"
                height="24px" viewBox="0 -960 960 960" width="24px" fill="#e8eaed">
                <path
                    d="m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Zm247-350Z">
                </path>
            </svg>
            
            <svg xmlns="http://www.w3.org/2000/svg"
                class="inline cursor-pointer"
                height="24px" viewBox="0 -960 960 960" width="24px" fill="#e8eaed">
                <path
                    d="m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Zm247-350Z">
                </path>
            </svg>
            
            <svg xmlns="http://www.w3.org/2000/svg"
                class="inline cursor-pointer"
                height="24px" viewBox="0 -960 960 960" width="24px" fill="#e8eaed">
                <path
                    d="m354-287 126-76 126 77-33-144 111-96-146-13-58-136-58 135-146 13 111 97-33 143ZM233-120l65-281L80-590l288-25 112-265 112 265 288 25-218 189 65 281-247-149-247 149Zm247-350Z">
                </path>
            </svg>
            
            </button>
    </div>
</div>


        <p class="text-xs text-amp-gray-600"><svg class="inline" xmlns="http://www.w3.org/2000/svg" width="20" height="21" viewBox="0 0 20 21" fill="none"><g id="schedule"><mask id="mask0_388_26358" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="20" height="21"><rect id="Bounding box" y="0.987793" width="20" height="20" fill="#D9D9D9"/></mask><g mask="url(#mask0_388_26358)"><path id="schedule_2" d="M12.7917 14.5295L13.8542 13.467L10.75 10.3628V5.98779H9.25V10.9878L12.7917 14.5295ZM10 18.9878C8.89756 18.9878 7.86153 18.7795 6.89192 18.3628C5.92231 17.9461 5.07292 17.3732 4.34375 16.644C3.61458 15.9149 3.04167 15.0645 2.625 14.0928C2.20833 13.1212 2 12.083 2 10.9783C2 9.8735 2.20833 8.83502 2.625 7.86279C3.04167 6.89057 3.61458 6.04335 4.34375 5.32113C5.07292 4.5989 5.92332 4.02946 6.89496 3.61279C7.86661 3.19613 8.90481 2.98779 10.0095 2.98779C11.1143 2.98779 12.1528 3.19779 13.1251 3.61779C14.0974 4.03779 14.9432 4.60779 15.6625 5.32779C16.3817 6.04779 16.9511 6.89446 17.3707 7.86779C17.7902 8.84113 18 9.88113 18 10.9878C18 12.0902 17.7917 13.1263 17.375 14.0959C16.9583 15.0655 16.3889 15.9149 15.6667 16.644C14.9444 17.3732 14.0963 17.9461 13.1223 18.3628C12.1482 18.7795 11.1075 18.9878 10 18.9878ZM10.0099 17.4878C11.8082 17.4878 13.3395 16.8524 14.6037 15.5815C15.8679 14.3107 16.5 12.7761 16.5 10.9779C16.5 9.17956 15.8679 7.64831 14.6037 6.38411C13.3395 5.1199 11.8082 4.48779 10.0099 4.48779C8.21165 4.48779 6.67708 5.1199 5.40625 6.38411C4.13542 7.64831 3.5 9.17956 3.5 10.9779C3.5 12.7761 4.13542 14.3107 5.40625 15.5815C6.67708 16.8524 8.21165 17.4878 10.0099 17.4878Z" fill="#5A5E68"/></g></g></svg> December 11th, 2025</p>
</div>

<div class="pl-8 border-y border-y-amp-gray-100  py-[2.12rem] gap-2">
    <div class="flex flex-col max-w-screen-xl mx-auto">
        <div><svg class="inline" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M478-240q21 0 35.5-14.5T528-290q0-21-14.5-35.5T478-340q-21 0-35.5 14.5T428-290q0 21 14.5 35.5T478-240Zm-36-154h74q0-33 7.5-52t42.5-52q26-26 41-49.5t15-56.5q0-56-41-86t-97-30q-57 0-92.5 30T342-618l66 26q5-18 22.5-39t53.5-21q32 0 48 17.5t16 38.5q0 20-12 37.5T506-526q-44 39-54 59t-10 73Zm38 314q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg> <p class="text-[0.875rem] text-amp-gray-600 inline">Need help? <a href="https://help.amplitude.com/hc/en-us/requests/new" class="text-amp-blue-300" target="_blank">Contact Support</a></p></div>
        <div><svg class="inline" xmlns="http://www.w3.org/2000/svg" width="20" height="21" viewBox="0 0 20 21" fill="none"><g id="icon-amplitude"><path id="Vector" fill-rule="evenodd" clip-rule="evenodd" d="M9.1805 7.21649C9.28367 7.3667 9.462 7.70394 9.72592 8.45712C9.90642 8.97243 10.1034 9.61079 10.3118 10.3556C9.52125 10.3442 8.72133 10.3356 7.94682 10.3275L7.55457 10.3232C7.99767 8.69717 8.53825 7.46332 8.93333 7.17198C8.95858 7.15678 8.99775 7.13881 9.04067 7.13881C9.0925 7.13881 9.13933 7.16553 9.1805 7.21649ZM15.3935 11.1677C15.393 11.1681 15.3924 11.1685 15.3918 11.169C15.3837 11.1756 15.3755 11.1819 15.3669 11.1878C15.3642 11.1897 15.3614 11.1917 15.3587 11.1936C15.3529 11.1973 15.347 11.2009 15.341 11.2043C15.3357 11.2075 15.3303 11.2108 15.3247 11.2137C15.3244 11.2139 15.324 11.214 15.3237 11.2142C15.2685 11.2433 15.2057 11.26 15.139 11.26H11.5864C11.6148 11.3784 11.6459 11.5129 11.6796 11.6593C11.8743 12.5048 12.3915 14.751 12.941 14.751L12.9517 14.7512L12.9578 14.7504L12.9683 14.7505C13.3974 14.7504 13.6165 14.1263 14.0966 12.759L14.1024 12.7425C14.1795 12.523 14.2666 12.2752 14.3608 12.013L14.3847 11.9462C14.4092 11.8808 14.4722 11.8344 14.5459 11.8344C14.6408 11.8344 14.7178 11.9118 14.7178 12.0073C14.7178 12.0245 14.7152 12.0413 14.7104 12.057L14.6906 12.1243C14.6404 12.287 14.5872 12.5087 14.5257 12.7653C14.2396 13.9579 13.8072 15.7596 12.6982 15.7596L12.6901 15.7595C11.9735 15.7539 11.5447 14.6017 11.3616 14.1097C11.0191 13.1897 10.76 12.2094 10.5101 11.26H7.23993L6.56109 13.4451L6.55113 13.4372C6.48906 13.5355 6.38018 13.5985 6.26002 13.5985C6.07048 13.5985 5.91552 13.4433 5.91467 13.2527L5.91509 13.2409L5.95619 12.9937C6.04997 12.4322 6.16233 11.8494 6.29045 11.26H4.90945L4.90435 11.2547C4.65368 11.2184 4.46117 10.996 4.46117 10.7368C4.46117 10.4825 4.64008 10.2661 4.88658 10.2221C4.90926 10.2192 4.95487 10.2153 5.04815 10.2153C5.06812 10.2153 5.09045 10.2155 5.11524 10.2159C5.55302 10.2235 6.01729 10.2305 6.52668 10.237C7.24757 7.29145 8.08242 5.79619 9.00842 5.79196C10.0022 5.79196 10.7393 8.06763 11.3294 10.2936L11.3317 10.3025C12.5441 10.3269 13.8364 10.3625 15.0926 10.4529L15.1452 10.4579C15.1654 10.4581 15.1852 10.4602 15.2045 10.4634L15.2118 10.4641C15.2141 10.4645 15.2161 10.4651 15.2182 10.4655C15.2193 10.4657 15.2205 10.466 15.2216 10.4662C15.4044 10.503 15.5401 10.6645 15.5401 10.8581C15.5401 10.9822 15.483 11.094 15.3935 11.1677ZM10 3.48779C5.85787 3.48779 2.5 6.86485 2.5 11.0306C2.5 15.1965 5.85787 18.5735 10 18.5735C14.1421 18.5735 17.5 15.1965 17.5 11.0306C17.5 6.86485 14.1421 3.48779 10 3.48779Z" fill="#5A5E68"/></g></svg> <p class="text-[0.875rem] text-amp-gray-600 inline">Visit <a href="https://www.amplitude.com" class="text-amp-blue-300" target="_blank">Amplitude.com</a></p></div>
        <div><svg class="inline" xmlns="http://www.w3.org/2000/svg" width="20" height="21" viewBox="0 0 20 21" fill="none"><g id="Icon Blog"><path id="Vector" d="M16.875 4.04193H3.125C2.39584 4.04193 1.80417 4.6336 1.80417 5.36276V16.6128C1.80417 17.3419 2.39584 17.9336 3.125 17.9336H16.875C17.6042 17.9336 18.1958 17.3419 18.1958 16.6128V5.36276C18.1958 4.6336 17.6042 4.04193 16.875 4.04193ZM16.8042 16.5419H3.2V5.43776H16.8042V16.5419ZM5.55417 8.48776C5.55417 8.10443 5.86667 7.79193 6.25 7.79193H13.75C14.1375 7.79193 14.4458 8.10443 14.4458 8.48776C14.4458 8.8711 14.1333 9.1836 13.75 9.1836H6.25C5.8625 9.1836 5.55417 8.8711 5.55417 8.48776ZM5.55417 10.9878C5.55417 10.6044 5.86667 10.2919 6.25 10.2919H13.75C14.1375 10.2919 14.4458 10.6044 14.4458 10.9878C14.4458 11.3711 14.1333 11.6836 13.75 11.6836H6.25C5.8625 11.6836 5.55417 11.3711 5.55417 10.9878ZM5.55417 13.4878C5.55417 13.1044 5.86667 12.7919 6.25 12.7919H13.75C14.1375 12.7919 14.4458 13.1044 14.4458 13.4878C14.4458 13.8711 14.1333 14.1836 13.75 14.1836H6.25C5.8625 14.1836 5.55417 13.8711 5.55417 13.4878Z" fill="#5A5E68"/></g></svg> <p class="text-[0.875rem] text-amp-gray-600 inline">Have a look at the Amplitude <a href="https://amplitude.com/blog" class="text-amp-blue-300" target="_blank">Blog</a></p></div>
        <div><svg class="inline" xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor"><path d="M478-240q21 0 35.5-14.5T528-290q0-21-14.5-35.5T478-340q-21 0-35.5 14.5T428-290q0 21 14.5 35.5T478-240Zm-36-154h74q0-33 7.5-52t42.5-52q26-26 41-49.5t15-56.5q0-56-41-86t-97-30q-57 0-92.5 30T342-618l66 26q5-18 22.5-39t53.5-21q32 0 48 17.5t16 38.5q0 20-12 37.5T506-526q-44 39-54 59t-10 73Zm38 314q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg> <p class="text-[0.875rem] text-amp-gray-600 inline">Learn more at  <a href="https://academy.amplitude.com/" class="text-amp-blue-300" target="_blank">Amplitude Academy</a></p></div>

    </div>
</div>
<div class="pl-8 border-b border-b-amp-gray-100 flex flex-col py-[2.12rem] gap-2">
    <div class="flex flex-row justify-between items-center max-w-screen-xl">
        <div class="flex flex-row">
            
                <a href="https://www.linkedin.com/company/amplitude-analytics" class="mr-4" target="_blank">
                    <svg class="w-6 h-6 fill-amp-gray-600" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g id="Icon"><path id="Vector" d="M19.7778 2C20.3671 2 20.9324 2.23413 21.3491 2.65087C21.7659 3.06762 22 3.63285 22 4.22222V19.7778C22 20.3671 21.7659 20.9324 21.3491 21.3491C20.9324 21.7659 20.3671 22 19.7778 22H4.22222C3.63285 22 3.06762 21.7659 2.65087 21.3491C2.23413 20.9324 2 20.3671 2 19.7778V4.22222C2 3.63285 2.23413 3.06762 2.65087 2.65087C3.06762 2.23413 3.63285 2 4.22222 2H19.7778ZM19.2222 19.2222V13.3333C19.2222 12.3727 18.8406 11.4513 18.1613 10.772C17.482 10.0927 16.5607 9.71111 15.6 9.71111C14.6556 9.71111 13.5556 10.2889 13.0222 11.1556V9.92222H9.92222V19.2222H13.0222V13.7444C13.0222 12.8889 13.7111 12.1889 14.5667 12.1889C14.9792 12.1889 15.3749 12.3528 15.6666 12.6445C15.9583 12.9362 16.1222 13.3319 16.1222 13.7444V19.2222H19.2222ZM6.31111 8.17778C6.80618 8.17778 7.28098 7.98111 7.63104 7.63104C7.98111 7.28098 8.17778 6.80618 8.17778 6.31111C8.17778 5.27778 7.34444 4.43333 6.31111 4.43333C5.81309 4.43333 5.33547 4.63117 4.98332 4.98332C4.63117 5.33547 4.43333 5.81309 4.43333 6.31111C4.43333 7.34444 5.27778 8.17778 6.31111 8.17778ZM7.85556 19.2222V9.92222H4.77778V19.2222H7.85556Z"/></g></svg>
                </a>
            
                <a href="https://twitter.com/Amplitude_HQ" class="mr-4" target="_blank">
                    <svg class="w-6 h-6 fill-amp-gray-600" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><g id="Frame 4824"><path id="Vector" d="M24 4.29446C23.1166 4.69598 22.1644 4.95985 21.1778 5.08604C22.1874 4.47801 22.9675 3.51434 23.3346 2.35564C22.3824 2.92925 21.327 3.33078 20.2141 3.56023C19.3078 2.57361 18.0344 2 16.5889 2C13.8929 2 11.6902 4.20268 11.6902 6.92161C11.6902 7.31166 11.7361 7.69025 11.8164 8.04589C7.73231 7.83939 4.0956 5.87763 1.67495 2.90631C1.25048 3.62906 1.00956 4.47801 1.00956 5.37285C1.00956 7.08222 1.86998 8.59656 3.20077 9.45698C2.38623 9.45698 1.62906 9.22753 0.963671 8.88337C0.963671 8.88337 0.963671 8.88337 0.963671 8.91778C0.963671 11.304 2.66157 13.3002 4.91013 13.7476C4.49713 13.8623 4.06119 13.9197 3.61377 13.9197C3.30402 13.9197 2.99426 13.8853 2.69599 13.8279C3.31549 15.7667 5.11664 17.2122 7.2849 17.2467C5.60994 18.5774 3.48757 19.3576 1.17017 19.3576C0.780115 19.3576 0.390057 19.3346 0 19.2887C2.17973 20.6883 4.77247 21.5029 7.54876 21.5029C16.5889 21.5029 21.5564 14 21.5564 7.49522C21.5564 7.27725 21.5564 7.07075 21.5449 6.85277C22.5086 6.16444 23.3346 5.29254 24 4.29446Z"/></g></svg>
                </a>
            
                <a href="https://www.g2.com/products/amplitude-analytics/reviews" class="mr-4" target="_blank">
                    <svg class="w-6 h-6 fill-amp-gray-600" xmlns="http://www.w3.org/2000/svg" width="21" height="20" viewBox="0 0 21 20"><g id="Frame 4825"><path id="path8" d="M11.0327 20C6.57742 19.9883 2.69803 17.1751 1.42954 12.9766C0.37117 9.45907 1.056 6.24504 3.43733 3.43569C4.90037 1.70805 6.78365 0.649677 9.00155 0.198312C10.2428 -0.0546084 11.5191 -0.0662816 12.7642 0.167183C12.9043 0.194421 12.9043 0.22944 12.8498 0.342281C12.2389 1.61466 11.628 2.89094 11.0249 4.16721C10.9938 4.24892 10.9121 4.29951 10.8226 4.29172C8.19999 4.35787 5.95874 6.20224 5.39064 8.76257C4.77975 11.4824 6.25057 14.2957 8.8498 15.2957C10.9121 16.0856 12.8265 15.7704 14.5736 14.4202C14.6631 14.354 14.6981 14.3385 14.7642 14.4513C15.4335 15.6225 16.1066 16.7899 16.7876 17.9572C16.8459 18.0584 16.8265 18.105 16.737 18.1673C15.4218 19.0973 13.9043 19.6926 12.309 19.9066C11.8809 19.9572 11.4568 19.9883 11.0327 20Z"/><path id="path10" d="M17.9512 17.105C17.8967 17.0739 17.8812 17.0155 17.8539 16.9649C17.0913 15.6497 16.3364 14.3345 15.5815 13.0155C15.5271 12.9065 15.4103 12.8404 15.2897 12.852C13.78 12.8559 12.2702 12.852 10.7605 12.852H10.5737C10.5737 12.7937 10.5932 12.7392 10.6321 12.6964C11.3986 11.3657 12.1652 10.031 12.9356 8.70027C12.9784 8.61078 13.0718 8.5563 13.173 8.56797C14.7177 8.57186 16.2664 8.57186 17.8111 8.56797C17.9084 8.5563 18.0018 8.61078 18.0446 8.70027C18.815 10.0427 19.5893 11.3851 20.3675 12.7275C20.422 12.7976 20.422 12.8949 20.3753 12.9688C19.5932 14.319 18.815 15.6653 18.0407 17.0155C18.0096 17.0427 18.0018 17.0894 17.9512 17.105Z"/><path id="path12" d="M14.6983 2.95331C14.422 2.67704 14.1613 2.41245 13.8967 2.15175C13.815 2.07004 13.8734 2.01167 13.9084 1.94941C14.2158 1.41634 14.7139 1.01945 15.3014 0.844348C16.0213 0.606992 16.8111 0.684814 17.4726 1.05836C18.675 1.70817 18.5699 3.2179 17.8734 3.90273C17.6088 4.15565 17.3131 4.36966 16.9862 4.54087C16.6516 4.71986 16.317 4.88718 15.9901 5.07784C15.7177 5.23348 15.5076 5.44749 15.4065 5.76267C15.3676 5.88718 15.3909 5.9222 15.5232 5.91831C16.4065 5.91442 17.2936 5.91831 18.1769 5.91442C18.3092 5.91442 18.3598 5.94166 18.3559 6.08563C18.3442 6.39691 18.3481 6.71209 18.3559 7.02338C18.3559 7.12065 18.3287 7.15567 18.2275 7.15567C16.8072 7.15178 15.3831 7.15178 13.9629 7.15567C13.8967 7.15567 13.8345 7.15567 13.8345 7.0584C13.8345 6.07395 14.0174 5.15566 14.7878 4.45527C15.1535 4.12842 15.566 3.85993 16.0096 3.6537C16.2547 3.53308 16.4999 3.42024 16.71 3.24903C16.8967 3.09728 17.0251 2.9144 17.0368 2.66537C17.0563 2.27626 16.7489 1.99222 16.2858 1.96109C15.6205 1.91439 15.1419 2.21401 14.8033 2.77043C14.7722 2.81712 14.7411 2.8716 14.6983 2.95331Z"/><path id="path14" d="M18.0869 18.5058V18.1828H17.9702V18.1167H18.2776V18.1828H18.1609V18.5058H18.0869ZM18.3321 18.5058V18.1167H18.4488L18.515 18.3813L18.5811 18.1167H18.6978V18.5058H18.6317V18.2023L18.5539 18.5058H18.4799L18.4021 18.2023V18.5058H18.3321Z"/></g></svg>
                </a>
            
        </div>
        <div class="flex flex-col pr-8">
            <div class="flex flex-row justify-between">
                
                    <a class="text-amp-gray-600 text-[0.875rem] font-[Gellix]" href="https://amplitude.com/terms" target="_blank">Terms of Service</a>
                
                    <a class="text-amp-gray-600 text-[0.875rem] font-[Gellix]" href="https://amplitude.com/privacy" target="_blank">Privacy Notice</a>
                
                    <a class="text-amp-gray-600 text-[0.875rem] font-[Gellix]" href="https://amplitude.com/aup" target="_blank">Acceptable Use Policy</a>
                
                    <a class="text-amp-gray-600 text-[0.875rem] font-[Gellix]" href="https://amplitude.com/legal" target="_blank">Legal</a>
                
            </div>
            <div><p class="text-[0.815rem] text-amp-gray-600 opacity-80 font-[Gellix]">© 2026 Amplitude, Inc. All rights reserved. Amplitude is a registered trademark of Amplitude, Inc.</p></div>
        </div>
    </div>
</div>
</section>
        </div>
      </div>
    
  </div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/tocbot/4.25.0/tocbot.min.js"></script>
    <script>

      // Get all h2 and h3 elements
      var headings = document.querySelectorAll('h2, h3');
  
      // Check if there are more than 3
      if (headings.length > 2) {
        // Execute your code here
        tocbot.init({
          // Where to render the table of contents.
          tocSelector: '.js-toc',
          // Where to grab the headings to build the table of contents.
          contentSelector: '.prose',
          // Which headings to grab inside of the contentSelector element.
          headingSelector: 'h2, h3',
          // For headings inside relative or absolute positioned containers within content.
          hasInnerContainers: true,
          ignoreSelector: '.hint-title, .js-toc-ignore',
          orderedList: false,
          ignoreHiddenElements: true,
          headingsOffset: 96,
          scrollSmoothOffset: -96
        });    }
     
    </script>

    
  
<script src="https://cdn.jsdelivr.net/npm/@docsearch/js@4"></script>
<script type="text/javascript">
  docsearch({
    appId: "93SYI9HL20",
    apiKey: "105a5cad34a7ac8f6a9fb78189d9c113",
    indexName: "amplitude-vercel",
    container: '#algolia-search-header',
    debug: true,
    placeholder: "Search 'instrumentation' , 'Export API'",
    transformItems(items) {
      return items.map((item) => ({
        ...item,
        url: item.url.replace('https://amplitude.com','')
      }))
    }
  });

  // Amplitude tracking for DocSearch
  (function() {
    var lastQuery = '';
    var searchOpen = false;

    document.addEventListener('click', function(e) {
      if (e.target.closest('.DocSearch-Button')) {
        amplitude.track('Search opened');
        searchOpen = true;
      }
    });

    document.addEventListener('input', function(e) {
      var input = document.querySelector('.DocSearch-Input');
      if (input && e.target === input) {
        lastQuery = input.value;
      }
    });

    // Use capture phase to run before DocSearch closes the modal
    document.addEventListener('click', function(e) {
      var hit = e.target.closest('.DocSearch-Hit');
      if (hit) {
        var query = lastQuery; // Capture query before any DOM changes
        var link = hit.querySelector('a');
        var url = link ? link.getAttribute('href') : '';
        var hits = document.querySelectorAll('.DocSearch-Hit');
        var position = Array.prototype.indexOf.call(hits, hit) + 1;
        amplitude.track('Search result clicked', { query: query, url: url, position: position });
      }
    }, true);

    var observer = new MutationObserver(function(mutations) {
      var modal = document.querySelector('.DocSearch-Modal');
      if (searchOpen && !modal) {
        if (lastQuery) {
          amplitude.track('Search query', { query: lastQuery });
        }
        lastQuery = '';
        searchOpen = false;
      } else if (modal && !searchOpen) {
        // Track search opened for keyboard shortcuts (Cmd+K/Ctrl+K)
        amplitude.track('Search opened');
        searchOpen = true;
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  })();
</script>
<script src="/docs/js/site.js?id=078a82617f7dafffff92da951b4ec6c9"></script>
<script src="/docs/js/statuspage.js?id=4da5c29a14b085ee38c353c2a7b7713c"></script>

<!-- Latest Version -->
<script src="https://cc.cdn.civiccomputing.com/9/cookieControl-9.x.min.js" type="text/javascript"></script>
<script>
    var config = {
            apiKey: "106b5e962520ab454786a0d1ba709e47372ef512",
            product: "PRO_MULTISITE",
            initialState: 'notify',
            notifyDismissButton: false,
            theme: 'light',
            setInnerHTML: true,
            branding: {
                fontFamily: 'IBM Plex Sans, sans-serif',
                backgroundColor: '#fafcfe',
                removeIcon: true,
                removeAbout: true,
            },
            statement: {
                description: 'See our',
                name: 'Privacy Notice',
                url: 'https://amplitude.com/privacy#cookies',
                updated: '25/04/2018',
            },

            ccpaConfig: {
                description: 'See our',
                name: 'Personal Information Notice',
                url: 'https://amplitude.com/privacy',
                updated: '25/04/2018',
            },

            ccpaConfig: {
                description: 'See our',
                name: 'Personal Information Notice',
                url: 'https://amplitude.com/privacy',
                updated: '25/04/2018',
            },
            text: {
                title: 'This site uses cookies.',
                intro: 'Some of these cookies are essential, while others help us to improve your experience by providing insights into how the site is being used.',
                necessaryTitle: 'Necessary Cookies',
                necessaryDescription: 'Necessary cookies enable core functionality. The website cannot function properly without these cookies, and can only be disabled by changing your browser preferences.',
                accept: 'Accept',
                reject: 'Reject',
                rejectSettings: "Do Not Sell or Share My Personal Information",

                // Regarding opening settings, "openCookieControl" should have been exposed
                // to the window by instrumentCookieControl() by, in the event it hasn't,
                // this falls back to CookieControl.open
                notifyDescription: `
		<div class="ccc-description">
			<div class="ccc-inner-description">
				<h2>Cookie Preferences</h2>
				<p>
					Sharing your cookies helps us improve site functionality and optimize your experience.
					<br><a href="https://amplitude.com/privacy#cookies" data-cta-clicked-type="interstitial" data-cc-policy>Click Here</a> to read our cookie policy.
				</p>
			</div>
			<div class="ccc-actions">
			<a class="ccc-manage-settings-btn" onclick="(window.openCookieControl || CookieControl.open)()"
					data-cta-clicked-type="interstitial"
					data-cc-settings>Manage Settings</a>
				<button onclick="CookieControl.acceptAll()" data-cc-accept data-cta-clicked-type="interstitial">
					Accept
				</button>
			</div>
		</div>`,
            },
            necessaryCookies: [
                '__utmzz', // utmz cookie replicator necessary to track utm google values
                '__utmzzses', // Also used by utmz cookie replciator
                'corp_utm', // Own cookie used to persist utm values for Marketo
                'membership_token_*', // Membership cookies for all access program
                'sj_csrftoken', // Skill Jar Cookie
            ],
            optionalCookies: [{
                    name: "performance",
                    label: "Performance Cookies",
                    description: 'We use these cookies to monitor and improve website performance.',
                    cookies: [
                        'amplitude_id*', // Amplitude SDK
                        'amp_*', // Newer Amplitude SDK
                        'AMP_*', // Newer Amplitude SDK
                        '1P_JAR', // Google Analytics
                        'DV', // Google Analytics
                        'NID', // Google Analytics
                        'OGPC', // Google Analytics
                        '_ga', // Google Analytics
                        '_gid', // Google Analytics
                        '_gat*', // Google Analytics
                    ],
                    onRevoke: function () {
                        amplitude.setOptOut(true)
                    }
                },
                {
                    name: "advertising",
                    label: "Advertising Cookies",
                    description: 'We use these cookies to help us improve the relevancy of advertising campaigns you receive.',
                    cookies: [
                        'BizoID', // LinkedIn
                        'UserMatchHistory', // LinkedIn
                        'lang', // LinkedIn
                        'bcookie', // LinkedIn
                        'bscookie', // LinkedIn
                        'lidc', // LinkedIn
                        'fr', // Facebook
                        'vc', // AddThis
                        'uvc', // AddThis
                        'uid', // AddThis
                        'loc', // AddThis
                        'ouid', // AddThis
                        'di2', // AddThis
                        '__atuvc', // AddThis
                        '__atuvs', // AddThis
                        '__d_mkto', // Marketo
                        '_mkto_trk', // Marketo
                        'BIGipServerab13web-app_https', // Marketo
                        'IDE', // Doubleclick,
                        'csv', // Reddit
                        'edgebucket', // Reddit
                        'loid', // Reddit
                        'over18', // Reddit
                        'recent_srs', // Reddit
                        'session_tracker', // Reddit
                        'token_v2', // Reddit
                        'IDE', // Doubleclick
                        '_uetsid', // Bing
                        '_uetvid', // Bing
                        '_uetsid_exp', // Bing
                        '_uetvid_exp', // Bing
                        '_uetmsclkid', // Bing
                        '_clsk', // Bing
                        'sa-user-id', // Stackadapt
                        'sa-user-id-v2', // Stackadapt
                    ],
                    onAccept: function () {

                    },
                    onRevoke: function () {

                    },
                }
            ]
    }

            CookieControl.load(config);
</script>

</body>
</html>