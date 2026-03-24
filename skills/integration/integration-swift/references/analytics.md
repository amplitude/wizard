<!--production-->

<!doctype html>
<html lang="en">
<head>
  <meta name='zd-site-verification' content='od3rs5oc4ggcruhipz6rp' />
  <meta charset="utf-8">
  

  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta content="" name="description">
  <meta name="google-site-verification" content="UHLjtoO7DV30dx3hVhwTOIWguEUr_VzS41msmq-uYKA" />
  
  <link rel="apple-touch-icon" sizes="180x180" href="/docs/assets/general/apple-touch-icon.png">
  <link rel="icon" type="image/png" sizes="32x32" href="/docs/assets/general/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/docs/assets/general/favicon-16x16.png">
  <title>Amplitude Analytics SDK Catalog | Amplitude</title>
  
  <script type="application/ld+json">
{
    "@context": "https://schema.org",
    "@type": "WebPage",
    "datePublished": "",
    "dateModified": "May 15th, 2024",
    "headline": "Amplitude Analytics SDK Catalog",
    "description": "",
    "url": "/docs/sdks/analytics",
    "primaryImageOfPage": {
        "@id": "/docs/assets/images/amplitude-default-seo.png"
    },
    "publisher": {
        "@type": "Organization",
        "name": "Amplitude",
        "legalName": "Amplitude Inc.",
        "url": "https://amplitude.com/",
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
            "contactType": "Customer Support",
            "telephone": "[+650-988-5131]",
            "email": "sales@amplitude.com"
        },
        "sameAs": [
            "https://twitter.com/Amplitude_HQ",
            "https://www.facebook.com/AmplitudeAnalytics/",
            "https://www.linkedin.com/company/amplitude-analytics"
        ]
    }
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
  <link href="/docs/css/site.css?id=cf9c3f0a1066ff8b5d94a25cd8d407e1" rel="stylesheet">
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
    
        
            <div class="flex-initial mr-4 text-sm p-2 transition hover:bg-amp-blue-950 hover:rounded hover:p-2 relative"><a class="no-underline font-normal " href="/docs/get-started">Get Started</a></div>
        
    
        
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
  
  <amp-side-nav current-uri="/docs/sdks/analytics" nav-title="analytics_sdks">
    
      
      
        
        <amp-nav-item 
          title="Analytics SDKs" 
          url="/docs/sdks/analytics" 
          slug="analytics-sdks"
          level="1"
          is-current>
        </amp-nav-item>

      
    
      
      
        
        <amp-nav-item 
          title="Browser" 
          slug="browser"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Browser Unified SDK" 
                  url="/docs/sdks/analytics/browser/browser-unified-sdk" 
                  slug="browser-unified-sdk"
                  parent-slug="browser"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Browser SDK 2" 
                  slug="browser-sdk-2"
                  parent-slug="browser"
                  has-children
                  level="2">
                  
                    
                    <amp-nav-item 
                      title="Browser SDK 2" 
                      url="/docs/sdks/analytics/browser/browser-sdk-2" 
                      slug="browser-sdk-2"
                      parent-slug="browser-sdk-2"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Ampli for Browser SDK 2.0" 
                      url="/docs/sdks/analytics/browser/ampli-for-browser-sdk-2-0" 
                      slug="ampli-for-browser-sdk-20"
                      parent-slug="browser-sdk-2"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Migrate from Browser SDK 1.0 to 2.0" 
                      url="/docs/sdks/analytics/browser/migrate-from-browser-sdk-1-0-to-2-0" 
                      slug="migrate-from-browser-sdk-10-to-20"
                      parent-slug="browser-sdk-2"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Cookies and consent management (Browser SDK)" 
                      url="/docs/sdks/analytics/browser/cookies-and-consent-management" 
                      slug="cookies-and-consent-management-browser-sdk"
                      parent-slug="browser-sdk-2"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Autocapture Plugin" 
                  url="/docs/sdks/analytics/browser/autocapture-plugin" 
                  slug="autocapture-plugin"
                  parent-slug="browser"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Browser SDK 1" 
                  slug="browser-sdk-1"
                  parent-slug="browser"
                  has-children
                  level="2">
                  
                    
                    <amp-nav-item 
                      title="Browser SDK 1" 
                      url="/docs/sdks/analytics/browser/browser-sdk-1" 
                      slug="browser-sdk-1"
                      parent-slug="browser-sdk-1"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Ampli for Browser SDK 1.0" 
                      url="/docs/sdks/analytics/browser/ampli-for-browser-sdk-1-0" 
                      slug="ampli-for-browser-sdk-10"
                      parent-slug="browser-sdk-1"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Android" 
          slug="android"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Android-Kotlin SDK" 
                  url="/docs/sdks/analytics/android/android-kotlin-sdk" 
                  slug="android-kotlin-sdk"
                  parent-slug="android"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Ampli for Android-Kotlin SDK" 
                  url="/docs/sdks/analytics/android/ampli-for-android-kotlin-sdk" 
                  slug="ampli-for-android-kotlin-sdk"
                  parent-slug="android"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Node" 
          slug="node"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Node.js SDK" 
                  url="/docs/sdks/analytics/node/node-js-sdk" 
                  slug="nodejs-sdk"
                  parent-slug="node"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Node.js Ampli Wrapper" 
                  url="/docs/sdks/analytics/node/node-js-ampli-wrapper" 
                  slug="nodejs-ampli-wrapper"
                  parent-slug="node"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Go" 
          slug="go"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Go SDK" 
                  url="/docs/sdks/analytics/go/go-sdk" 
                  slug="go-sdk"
                  parent-slug="go"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Ampli for Go" 
                  url="/docs/sdks/analytics/go/ampli-for-go" 
                  slug="ampli-for-go"
                  parent-slug="go"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Python" 
          slug="python"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Python SDK" 
                  url="/docs/sdks/analytics-sdks/python/python-sdk" 
                  slug="python-sdk"
                  parent-slug="python"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Ampli for Python SDK" 
                  url="/docs/sdks/analytics-sdks/python/ampli-for-python-sdk" 
                  slug="ampli-for-python-sdk"
                  parent-slug="python"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="iOS" 
          slug="ios"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="iOS Swift SDK" 
                  url="/docs/sdks/analytics/ios/ios-swift-sdk" 
                  slug="ios-swift-sdk"
                  parent-slug="ios"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Ampli for iOS Swift SDK" 
                  url="/docs/sdks/analytics/ios/ampli-for-ios-swift-sdk" 
                  slug="ampli-for-ios-swift-sdk"
                  parent-slug="ios"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Unified SDK for Swift" 
                  url="/docs/sdks/analytics/ios/unified-sdk" 
                  slug="unified-sdk-for-swift"
                  parent-slug="ios"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Flutter" 
          slug="flutter"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Flutter SDK 3" 
                  url="/docs/sdks/analytics/flutter/flutter-sdk" 
                  slug="flutter-sdk-3"
                  parent-slug="flutter"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Flutter SDK 4" 
                  url="/docs/sdks/analytics/flutter/flutter-sdk-4" 
                  slug="flutter-sdk-4"
                  parent-slug="flutter"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Flutter SDK 4.0 Migration Guide" 
                  url="/docs/sdks/analytics/flutter/flutter-sdk-4-0-migration-guide" 
                  slug="flutter-sdk-40-migration-guide"
                  parent-slug="flutter"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Java" 
          slug="java"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="JRE Java SDK" 
                  url="/docs/sdks/analytics/java/jre-java-sdk" 
                  slug="jre-java-sdk"
                  parent-slug="java"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Ampli for Java SDK" 
                  url="/docs/sdks/analytics/java/ampli-for-java-sdk" 
                  slug="ampli-for-java-sdk"
                  parent-slug="java"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="React Native" 
          slug="react-native"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="React Native SDK" 
                  url="/docs/sdks/analytics/react-native/react-native-sdk" 
                  slug="react-native-sdk"
                  parent-slug="react-native"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Migrate to the latest React Native SDK" 
                  url="/docs/sdks/analytics/react-native/migrate-to-the-latest-react-native-sdk" 
                  slug="migrate-to-the-latest-react-native-sdk"
                  parent-slug="react-native"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Ampli for the React Native SDK" 
                  url="/docs/sdks/analytics/react-native/ampli-for-the-react-native-sdk" 
                  slug="ampli-for-the-react-native-sdk"
                  parent-slug="react-native"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Unreal" 
          slug="unreal"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Unreal SDK" 
                  url="/docs/sdks/analytics/unreal/unreal-sdk" 
                  slug="unreal-sdk"
                  parent-slug="unreal"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Unity" 
          slug="unity"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Unity SDK" 
                  url="/docs/sdks/analytics/unity/unity-sdk" 
                  slug="unity-sdk"
                  parent-slug="unity"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
        </amp-nav-item>
      
    
      
      
        
        <amp-nav-item 
          title="Maintenance SDKs" 
          slug="maintenance-sdks"
          has-children
          level="1">
          
            
            
              
                
                <amp-nav-item 
                  title="Marketing Analytics SDK" 
                  slug="marketing-analytics-sdk"
                  parent-slug="maintenance-sdks"
                  has-children
                  level="2">
                  
                    
                    <amp-nav-item 
                      title="Marketing Analytics SDK" 
                      url="/docs/sdks/analytics/browser/marketing-analytics-sdk" 
                      slug="marketing-analytics-sdk"
                      parent-slug="marketing-analytics-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Migrate from Marketing Analytics to Browser SDK 2.0" 
                      url="/docs/sdks/analytics/browser/migrate-from-marketing-analytics-to-browser-sdk-2-0" 
                      slug="migrate-from-marketing-analytics-to-browser-sdk-20"
                      parent-slug="marketing-analytics-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Javascript SDK" 
                  slug="javascript-sdk"
                  parent-slug="maintenance-sdks"
                  has-children
                  level="2">
                  
                    
                    <amp-nav-item 
                      title="Javascript SDK" 
                      url="/docs/sdks/analytics/browser/javascript-sdk" 
                      slug="javascript-sdk"
                      parent-slug="javascript-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Ampli for Javascript SDK" 
                      url="/docs/sdks/analytics/browser/ampli-for-javascript-sdk" 
                      slug="ampli-for-javascript-sdk"
                      parent-slug="javascript-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Migrate from Javascript SDK to Browser SDK 1.0" 
                      url="/docs/sdks/analytics/browser/migrate-from-javascript-sdk-to-browser-sdk-1-0" 
                      slug="migrate-from-javascript-sdk-to-browser-sdk-10"
                      parent-slug="javascript-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Migrate from Javascript SDK to Browser SDK 2.0" 
                      url="/docs/sdks/analytics/browser/migrate-from-javascript-sdk-to-browser-sdk-2-0" 
                      slug="migrate-from-javascript-sdk-to-browser-sdk-20"
                      parent-slug="javascript-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Cookies and Consent Management (JavaScript SDK)" 
                      url="/docs/sdks/analytics/browser/cookies-and-consent-management-javascript-sdk" 
                      slug="cookies-and-consent-management-javascript-sdk"
                      parent-slug="javascript-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="React Native SDK (maintenance)" 
                  url="/docs/sdks/analytics/react-native/react-native-sdk-maintenance" 
                  slug="react-native-sdk-maintenance"
                  parent-slug="maintenance-sdks"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="iOS SDK" 
                  url="/docs/sdks/analytics/ios/ios-sdk" 
                  slug="ios-sdk"
                  parent-slug="maintenance-sdks"
                  level="2"
                  >
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Node SDK" 
                  slug="node-sdk"
                  parent-slug="maintenance-sdks"
                  has-children
                  level="2">
                  
                    
                    <amp-nav-item 
                      title="Node SDK" 
                      url="/docs/sdks/analytics/node/node-sdk" 
                      slug="node-sdk"
                      parent-slug="node-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Ampli for Node SDK" 
                      url="/docs/sdks/analytics/node/ampli-for-node-sdk" 
                      slug="ampli-for-node-sdk"
                      parent-slug="node-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Node.js SDK Migration Guide" 
                      url="/docs/sdks/analytics/node/node-js-sdk-migration-guide" 
                      slug="nodejs-sdk-migration-guide"
                      parent-slug="node-sdk"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                </amp-nav-item>
              
            
          
            
            
              
                
                <amp-nav-item 
                  title="Android SDK 1.0" 
                  slug="android-sdk-10"
                  parent-slug="maintenance-sdks"
                  has-children
                  level="2">
                  
                    
                    <amp-nav-item 
                      title="Android SDK" 
                      url="/docs/sdks/analytics/android/android-sdk" 
                      slug="android-sdk"
                      parent-slug="android-sdk-10"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
                    
                    <amp-nav-item 
                      title="Migrate to the Android-Kotlin SDK" 
                      url="/docs/sdks/analytics/android/migrate-to-the-android-kotlin-sdk" 
                      slug="migrate-to-the-android-kotlin-sdk"
                      parent-slug="android-sdk-10"
                      
                      level="3"
                      >
                    </amp-nav-item>
                  
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
        href="/docs/sdks">SDKs</a></div>
    <span class="mr-2">/</span><div class="mr-2 text-s text-gray-500 "><a class="font-semibold"
        href="/docs/sdks/analytics">Amplitude Analytics SDK Catalog</a></div>
    
    
</div>
    <div class="flex flex-row w-full p-8">
      <div class="copy">
        <div class="flex flex-row items-start justify-between">
          <h1 class="font-[Gellix] font-normal mb-5">Amplitude Analytics SDK Catalog</h1>
          
        </div>
        <div
          class=" prose-a:text-amp-blue-300 prose-ol:list-decimal prose-ol:list-outside prose-pre:bg-[#fafafa] w-full">
          <div class="flex flex-wrap gap-4">
            
            <a href="/docs/sdks/analytics/android">
            <div
                class="border border-amp-gray-100 rounded h-24 w-64 p-4 hover:shadow-lg transition-shadow flex items-center">
                <div><?xml version="1.0" encoding="UTF-8" standalone="no"?><svg class="h-12 w-12 max-w-12 max-h-12" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" width="224.8299mm" height="35.448391mm" viewBox="0 0 224.8299 35.448391" version="1.1" id="svg5"><defs id="defs2"><linearGradient id="linearGradient41415"><stop style="stop-color:#4bb064;stop-opacity:1;" offset="0" id="stop41411"/><stop style="stop-color:#90ca9e;stop-opacity:1;" offset="0.27083334" id="stop41419"/><stop style="stop-color:#90ca9e;stop-opacity:0;" offset="1" id="stop41413"/></linearGradient><linearGradient id="linearGradient40562"><stop style="stop-color:#85ac8c;stop-opacity:1;" offset="0" id="stop40558"/><stop style="stop-color:#6ec57e;stop-opacity:1;" offset="1" id="stop40560"/></linearGradient><linearGradient id="linearGradient40080"><stop style="stop-color:#41ad59;stop-opacity:1;" offset="0.15555555" id="stop40076"/><stop style="stop-color:#89cb95;stop-opacity:1;" offset="0.43333331" id="stop41324"/><stop style="stop-color:#82cc8c;stop-opacity:1;" offset="1" id="stop40078"/></linearGradient><linearGradient id="linearGradient38160"><stop style="stop-color:#409462;stop-opacity:1;" offset="0.11666667" id="stop38156"/><stop style="stop-color:#83b785;stop-opacity:1;" offset="1" id="stop38158"/></linearGradient><linearGradient id="linearGradient33156"><stop style="stop-color:#0e2010;stop-opacity:1;" offset="0" id="stop33150"/><stop style="stop-color:#050208;stop-opacity:1;" offset="0.40902776" id="stop33152"/><stop style="stop-color:#0c090e;stop-opacity:1;" offset="0.75999999" id="stop33158"/><stop style="stop-color:#001406;stop-opacity:1;" offset="1" id="stop33154"/></linearGradient><linearGradient id="linearGradient28572"><stop style="stop-color:#4f9765;stop-opacity:1;" offset="0" id="stop28562"/><stop style="stop-color:#449a5f;stop-opacity:1;" offset="0.125" id="stop28574"/><stop style="stop-color:#229a4e;stop-opacity:1;" offset="0.25" id="stop28564"/><stop style="stop-color:#44a560;stop-opacity:1;" offset="0.5" id="stop28566"/><stop style="stop-color:#42a95f;stop-opacity:1;" offset="0.75" id="stop28568"/><stop style="stop-color:#44ac66;stop-opacity:1;" offset="1" id="stop28570"/></linearGradient><linearGradient id="linearGradient25399"><stop style="stop-color:#7cbc95;stop-opacity:0.36538461;" offset="0" id="stop25395"/><stop style="stop-color:#b6d2bb;stop-opacity:0.64903849;" offset="1" id="stop25397"/></linearGradient><linearGradient id="linearGradient25048"><stop style="stop-color:#3b9261;stop-opacity:1;" offset="0.07777778" id="stop25038"/><stop style="stop-color:#229a4e;stop-opacity:1;" offset="0.25" id="stop25040"/><stop style="stop-color:#44a560;stop-opacity:1;" offset="0.5" id="stop25042"/><stop style="stop-color:#42a95f;stop-opacity:1;" offset="0.75" id="stop25044"/><stop style="stop-color:#44ac66;stop-opacity:1;" offset="1" id="stop25046"/></linearGradient><linearGradient id="linearGradient21707"><stop style="stop-color:#3b9261;stop-opacity:1;" offset="0" id="stop21705"/><stop style="stop-color:#229a4e;stop-opacity:1;" offset="0.25" id="stop23164"/><stop style="stop-color:#44a560;stop-opacity:1;" offset="0.5" id="stop22610"/><stop style="stop-color:#42a95f;stop-opacity:1;" offset="0.75" id="stop23718"/><stop style="stop-color:#44ac66;stop-opacity:1;" offset="1" id="stop21703"/></linearGradient><linearGradient id="linearGradient19555"><stop style="stop-color:#51aa63;stop-opacity:1;" offset="0" id="stop19549"/><stop style="stop-color:#44aa59;stop-opacity:1;" offset="0.28749999" id="stop19557"/><stop style="stop-color:#4daf60;stop-opacity:1;" offset="0.7638889" id="stop19551"/><stop style="stop-color:#61a76a;stop-opacity:1;" offset="0.8458333" id="stop34205"/><stop style="stop-color:#7fa186;stop-opacity:1;" offset="1" id="stop19553"/></linearGradient><linearGradient id="linearGradient18066"><stop style="stop-color:#a7d4aa;stop-opacity:1;" offset="0" id="stop18064"/><stop style="stop-color:#9acfa1;stop-opacity:1;" offset="0.52638888" id="stop18693"/><stop style="stop-color:#89c98f;stop-opacity:1;" offset="1" id="stop18062"/></linearGradient><linearGradient id="linearGradient15579"><stop style="stop-color:#4faa63;stop-opacity:1;" offset="0" id="stop15577"/><stop style="stop-color:#4daf60;stop-opacity:1;" offset="0.7638889" id="stop15930"/><stop style="stop-color:#7fa186;stop-opacity:1;" offset="1" id="stop15575"/></linearGradient><linearGradient id="linearGradient14045"><stop style="stop-color:#0e2010;stop-opacity:1;" offset="0" id="stop14043"/><stop style="stop-color:#050208;stop-opacity:1;" offset="0.40902776" id="stop30950"/><stop style="stop-color:#09130b;stop-opacity:1;" offset="0.81805551" id="stop14883"/></linearGradient><linearGradient id="linearGradient13054"><stop style="stop-color:#010001;stop-opacity:1;" offset="0" id="stop13050"/><stop style="stop-color:#010203;stop-opacity:1;" offset="0.5" id="stop13819"/><stop style="stop-color:#001000;stop-opacity:1;" offset="1" id="stop13052"/></linearGradient><radialGradient xlink:href="#linearGradient13054" id="radialGradient13058" cx="177.22487" cy="118.77674" fx="177.22487" fy="118.77674" r="2.4496355" gradientTransform="matrix(1,0,0,1.112451,8.8900403,-11.865027)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#linearGradient19555" id="radialGradient15581" cx="173.17831" cy="140.96013" fx="173.17831" fy="140.96013" r="25.530479" gradientTransform="matrix(1.04395,0,0,0.90072764,-7.6111992,-0.03903516)" gradientUnits="userSpaceOnUse"/><filter style="color-interpolation-filters:sRGB" id="filter17368" x="-0.13333943" y="-0.55206027" width="1.2666789" height="2.1041205"/><linearGradient xlink:href="#linearGradient18066" id="linearGradient18068" x1="173.16978" y1="104.60963" x2="173.16978" y2="115.03044" gradientUnits="userSpaceOnUse"/><filter style="color-interpolation-filters:sRGB" id="filter19184" x="-0.18752626" y="-0.73417565" width="1.3750525" height="2.4683513"/><clipPath clipPathUnits="userSpaceOnUse" id="clipPath19190"><path id="path19192" style="fill:url(#radialGradient19194);fill-opacity:1;stroke-width:11.0002;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" d="m 173.16979,103.93164 a 25.680634,25.680634 0 0 0 -25.52195,22.99601 h 51.06096 a 25.680634,25.680634 0 0 0 -25.53901,-22.99601 z"/></clipPath><radialGradient xlink:href="#linearGradient15579" id="radialGradient19194" gradientUnits="userSpaceOnUse" gradientTransform="matrix(1.04395,0,0,0.90072763,-7.6111992,-0.03903516)" cx="173.17831" cy="140.96013" fx="173.17831" fy="140.96013" r="25.530479"/><clipPath clipPathUnits="userSpaceOnUse" id="clipPath19198"><path id="path19200" style="fill:url(#radialGradient19202);fill-opacity:1;stroke-width:15.5367;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" d="m 173.11985,103.65204 a 36.271255,36.271255 0 0 0 -36.04713,32.4795 h 72.11836 a 36.271255,36.271255 0 0 0 -36.07123,-32.4795 z"/></clipPath><radialGradient xlink:href="#linearGradient15579" id="radialGradient19202" gradientUnits="userSpaceOnUse" gradientTransform="matrix(1.474472,0,0,1.2721852,-82.214709,-43.19585)" cx="173.17831" cy="140.96013" fx="173.17831" fy="140.96013" r="25.530479"/><linearGradient xlink:href="#linearGradient25048" id="linearGradient21709" x1="157.50719" y1="104.1368" x2="161.44235" y2="101.97052" gradientUnits="userSpaceOnUse"/><filter style="color-interpolation-filters:sRGB" id="filter25026" x="-0.15901417" y="-0.146466" width="1.3180283" height="1.292932"/><clipPath clipPathUnits="userSpaceOnUse" id="clipPath25032"><path id="path25034" style="fill:url(#linearGradient25036);fill-opacity:1;stroke-width:8.245;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" d="m 157.35215,97.254528 c -1.2238,3e-6 -2.21588,0.99209 -2.21588,2.215886 5.3e-4,0.349324 0.0839,0.693546 0.24288,1.004586 l 4.25607,7.32359 3.03857,-0.36277 1.04335,-1.69395 -4.54959,-7.542697 c -0.41478,-0.592193 -1.09239,-0.944785 -1.8154,-0.944645 z"/></clipPath><linearGradient xlink:href="#linearGradient21707" id="linearGradient25036" gradientUnits="userSpaceOnUse" x1="157.50719" y1="104.1368" x2="161.44235" y2="101.97052"/><linearGradient xlink:href="#linearGradient25399" id="linearGradient25401" x1="160.25763" y1="100.00639" x2="156.13103" y2="97.621071" gradientUnits="userSpaceOnUse"/><filter style="color-interpolation-filters:sRGB" id="filter28167" x="-0.047869877" y="-0.044092354" width="1.0957398" height="1.0881847"/><linearGradient xlink:href="#linearGradient25048" id="linearGradient28199" gradientUnits="userSpaceOnUse" x1="157.50719" y1="104.1368" x2="161.44235" y2="101.97052" gradientTransform="matrix(-1,0,0,1,346.44948,0)"/><linearGradient xlink:href="#linearGradient25399" id="linearGradient28201" gradientUnits="userSpaceOnUse" x1="160.25763" y1="100.00639" x2="156.13103" y2="97.621071"/><linearGradient xlink:href="#linearGradient25399" id="linearGradient28203" gradientUnits="userSpaceOnUse" x1="160.25763" y1="100.00639" x2="156.13103" y2="97.621071"/><linearGradient xlink:href="#linearGradient28572" id="linearGradient28205" gradientUnits="userSpaceOnUse" x1="157.50719" y1="104.1368" x2="161.44235" y2="101.97052" gradientTransform="matrix(-1,0,0,1,346.44948,0)"/><linearGradient xlink:href="#linearGradient25399" id="linearGradient28207" gradientUnits="userSpaceOnUse" x1="160.25763" y1="100.00639" x2="156.13103" y2="97.621071"/><linearGradient xlink:href="#linearGradient25399" id="linearGradient28209" gradientUnits="userSpaceOnUse" x1="160.25763" y1="100.00639" x2="156.13103" y2="97.621071"/><linearGradient xlink:href="#linearGradient33156" id="linearGradient29430" x1="-165.42984" y1="118.34532" x2="-162.14827" y2="120.62858" gradientUnits="userSpaceOnUse"/><filter style="color-interpolation-filters:sRGB" id="filter31284" x="-0.053902708" y="-0.044768501" width="1.1078054" height="1.089537"/><clipPath clipPathUnits="userSpaceOnUse" id="clipPath32049"><ellipse style="fill:url(#linearGradient32053);fill-opacity:1;stroke-width:8.94842;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" id="ellipse32051" cx="-164.01886" cy="119.57114" rx="2.4496355" ry="2.7093031" transform="matrix(-1,0,0.17634434,0.98432854,0,0)"/></clipPath><linearGradient xlink:href="#linearGradient14045" id="linearGradient32053" gradientUnits="userSpaceOnUse" x1="-165.42984" y1="118.34532" x2="-162.14827" y2="120.62858"/><filter style="color-interpolation-filters:sRGB" id="filter32602" x="-0.11949068" y="-0.47861589" width="1.2389814" height="1.9572318"/><filter style="color-interpolation-filters:sRGB" id="filter33138" x="-0.15918764" y="-0.37858438" width="1.3183753" height="1.7571688"/><clipPath clipPathUnits="userSpaceOnUse" id="clipPath33144"><ellipse style="fill:url(#linearGradient33148);fill-opacity:1;stroke-width:8.94842;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" id="ellipse33146" cx="-164.01886" cy="119.57114" rx="2.4496355" ry="2.7093031" transform="matrix(-1,0,0.17634434,0.98432854,0,0)"/></clipPath><linearGradient xlink:href="#linearGradient14045" id="linearGradient33148" gradientUnits="userSpaceOnUse" x1="-165.42984" y1="118.34532" x2="-162.14827" y2="120.62858"/><filter style="color-interpolation-filters:sRGB" id="filter34203" x="-0.027714726" y="-0.2080222" width="1.0554295" height="1.4160444"/><filter style="color-interpolation-filters:sRGB" id="filter37117" x="-0.14793818" y="-0.13375935" width="1.2958764" height="1.2675187"/><linearGradient xlink:href="#linearGradient38160" id="linearGradient38162" x1="-163.54109" y1="122.28044" x2="-164.49663" y2="116.86183" gradientUnits="userSpaceOnUse"/><filter style="color-interpolation-filters:sRGB" id="filter39686" x="-0.0078218324" y="-0.058709394" width="1.0156437" height="1.1174188"/><filter style="color-interpolation-filters:sRGB" id="filter40028" x="-0.22826241" y="-0.31615987" width="1.4565248" height="1.6323197"/><clipPath clipPathUnits="userSpaceOnUse" id="clipPath40046"><g id="g40060"><path id="path40048" style="fill:url(#linearGradient40062);fill-opacity:1;stroke-width:8.245;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" d="m 157.35215,97.254529 c -1.2238,3e-6 -2.21588,0.992088 -2.21588,2.215885 6.4e-4,0.349325 0.0839,0.693546 0.24288,1.004586 l 4.25607,7.32359 3.03857,-0.36277 1.04335,-1.69395 -4.54959,-7.542696 c -0.41478,-0.592193 -1.09239,-0.944787 -1.8154,-0.944645 z"/><path style="mix-blend-mode:normal;fill:url(#linearGradient40064);fill-opacity:1;stroke:none;stroke-width:0.600001;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter25026)" d="m 155.13627,98.852496 c 1.26535,-0.92185 2.46098,-1.189321 3.6468,-0.446521 l 4.16719,7.821755 1.75286,-1.05833 -2.97656,-7.639845 -3.57187,-1.85829 -3.175,1.72599 z" id="path40050" clip-path="url(#clipPath25032)"/><path style="mix-blend-mode:normal;fill:url(#linearGradient40066);fill-opacity:1;stroke:none;stroke-width:0.600001;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter28167)" d="m 155.13627,98.852496 c 1.26535,-0.92185 2.46098,-1.189321 3.6468,-0.446521 l 4.16719,7.821755 1.75286,-1.05833 -2.97656,-7.639845 -3.57187,-1.85829 -3.175,1.72599 z" id="path40052" clip-path="url(#clipPath25032)"/><path id="path40054" style="fill:url(#linearGradient40068);fill-opacity:1;stroke-width:8.245;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" d="m 157.35215,97.254529 c -1.2238,3e-6 -2.21588,0.992088 -2.21588,2.215885 6.4e-4,0.349325 0.0839,0.693546 0.24288,1.004586 l 4.25607,7.32359 3.03857,-0.36277 1.04335,-1.69395 -4.54959,-7.542696 c -0.41478,-0.592193 -1.09239,-0.944787 -1.8154,-0.944645 z"/><path style="mix-blend-mode:normal;fill:url(#linearGradient40070);fill-opacity:1;stroke:none;stroke-width:0.600001;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter25026)" d="m 155.13627,98.852496 c 1.26535,-0.92185 2.46098,-1.189321 3.6468,-0.446521 l 4.16719,7.821755 1.75286,-1.05833 -2.97656,-7.639845 -3.57187,-1.85829 -3.175,1.72599 z" id="path40056" clip-path="url(#clipPath25032)"/><path style="mix-blend-mode:normal;fill:url(#linearGradient40072);fill-opacity:1;stroke:none;stroke-width:0.600001;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter28167)" d="m 155.13627,98.852496 c 1.26535,-0.92185 2.46098,-1.189321 3.6468,-0.446521 l 4.16719,7.821755 1.75286,-1.05833 -2.97656,-7.639845 -3.57187,-1.85829 -3.175,1.72599 z" id="path40058" clip-path="url(#clipPath25032)"/></g></clipPath><linearGradient xlink:href="#linearGradient25048" id="linearGradient40062" gradientUnits="userSpaceOnUse" x1="157.50719" y1="104.1368" x2="161.44235" y2="101.97052"/><linearGradient xlink:href="#linearGradient25399" id="linearGradient40064" gradientUnits="userSpaceOnUse" x1="160.25763" y1="100.00639" x2="156.13103" y2="97.621071"/><linearGradient xlink:href="#linearGradient25399" id="linearGradient40066" gradientUnits="userSpaceOnUse" x1="160.25763" y1="100.00639" x2="156.13103" y2="97.621071"/><linearGradient xlink:href="#linearGradient25048" id="linearGradient40068" gradientUnits="userSpaceOnUse" x1="157.50719" y1="104.1368" x2="161.44235" y2="101.97052"/><linearGradient xlink:href="#linearGradient25399" id="linearGradient40070" gradientUnits="userSpaceOnUse" x1="160.25763" y1="100.00639" x2="156.13103" y2="97.621071"/><linearGradient xlink:href="#linearGradient25399" id="linearGradient40072" gradientUnits="userSpaceOnUse" x1="160.25763" y1="100.00639" x2="156.13103" y2="97.621071"/><linearGradient xlink:href="#linearGradient40080" id="linearGradient40082" x1="161.54057" y1="106.54541" x2="162.6738" y2="107.43582" gradientUnits="userSpaceOnUse"/><filter style="color-interpolation-filters:sRGB" id="filter40500" x="-0.30771885" y="-0.42621276" width="1.6154377" height="1.8524255"/><linearGradient xlink:href="#linearGradient40562" id="linearGradient40564" x1="155.13757" y1="111.78979" x2="163.71713" y2="105.74187" gradientUnits="userSpaceOnUse"/><filter style="color-interpolation-filters:sRGB" id="filter41256" x="-0.06033335" y="-0.080505232" width="1.1206667" height="1.1610105"/><clipPath clipPathUnits="userSpaceOnUse" id="clipPath41262"><path id="path41264" style="fill:url(#radialGradient41266);fill-opacity:1;stroke-width:11.0002;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" d="m 173.16979,103.93164 a 25.680634,25.680634 0 0 0 -25.52195,22.99601 h 51.06096 a 25.680634,25.680634 0 0 0 -25.53901,-22.99601 z"/></clipPath><radialGradient xlink:href="#linearGradient19555" id="radialGradient41266" gradientUnits="userSpaceOnUse" gradientTransform="matrix(1.04395,0,0,0.90072763,-7.6111992,-0.03903516)" cx="173.17831" cy="140.96013" fx="173.17831" fy="140.96013" r="25.530479"/><filter style="color-interpolation-filters:sRGB" id="filter41272" x="-0.0041782101" y="-0.0055751548" width="1.0083564" height="1.0111503"/><linearGradient xlink:href="#linearGradient40562" id="linearGradient41292" gradientUnits="userSpaceOnUse" x1="155.13757" y1="111.78979" x2="163.71713" y2="105.74187"/><linearGradient xlink:href="#linearGradient40562" id="linearGradient41294" gradientUnits="userSpaceOnUse" x1="155.13757" y1="111.78979" x2="163.71713" y2="105.74187"/><linearGradient xlink:href="#linearGradient25048" id="linearGradient41395" gradientUnits="userSpaceOnUse" x1="157.50719" y1="104.1368" x2="161.44235" y2="101.97052"/><linearGradient xlink:href="#linearGradient25399" id="linearGradient41397" gradientUnits="userSpaceOnUse" x1="160.25763" y1="100.00639" x2="156.13103" y2="97.621071"/><linearGradient xlink:href="#linearGradient25399" id="linearGradient41399" gradientUnits="userSpaceOnUse" x1="160.25763" y1="100.00639" x2="156.13103" y2="97.621071"/><linearGradient xlink:href="#linearGradient25399" id="linearGradient41401" gradientUnits="userSpaceOnUse" x1="160.25763" y1="100.00639" x2="156.13103" y2="97.621071"/><linearGradient xlink:href="#linearGradient41415" id="linearGradient41417" x1="161.62859" y1="105.74187" x2="162.97255" y2="107.79859" gradientUnits="userSpaceOnUse"/><linearGradient xlink:href="#linearGradient33156" id="linearGradient42528" gradientUnits="userSpaceOnUse" x1="-165.42984" y1="118.34532" x2="-162.14827" y2="120.62858"/><linearGradient xlink:href="#linearGradient40562" id="linearGradient42530" gradientUnits="userSpaceOnUse" x1="155.13757" y1="111.78979" x2="163.71713" y2="105.74187"/><linearGradient xlink:href="#linearGradient40562" id="linearGradient42532" gradientUnits="userSpaceOnUse" x1="155.13757" y1="111.78979" x2="163.71713" y2="105.74187"/><linearGradient xlink:href="#linearGradient40562" id="linearGradient42534" gradientUnits="userSpaceOnUse" x1="155.13757" y1="111.78979" x2="163.71713" y2="105.74187"/></defs><g id="layer1" transform="translate(9.6811659,-97.476099)"><g id="g42572"><path id="rect366" style="fill:#242424;fill-opacity:1;stroke-width:9.65731;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" d="M 3.2482807,97.476099 -9.6811659,132.28168 h 5.6206564 l 2.9477273,-8.44915 H 13.831046 l 2.947728,8.44915 h 5.620052 L 9.469378,97.476099 Z m 61.5161073,0 v 14.752551 c -1.996101,-1.91217 -4.088469,-2.93925 -6.445657,-2.93925 -6.136065,0 -11.358133,5.34377 -11.358133,11.85145 0,6.50763 5.281883,11.78364 11.316974,11.78364 2.234347,0 4.100659,-0.72016 6.486816,-3.10631 v 2.4635 h 4.914291 V 97.476099 Z m 73.340912,0 v 14.752551 c -1.99609,-1.91217 -4.08847,-2.93925 -6.44566,-2.93925 -6.13606,0 -11.35813,5.34377 -11.35813,11.85145 0,6.50763 5.28188,11.78364 11.31697,11.78364 2.23436,0 4.10066,-0.72016 6.48682,-3.10631 v 2.4635 h 4.91429 V 97.476099 Z m -22.73019,1.866087 a 3.2418197,3.2418197 0 0 0 -3.24128,3.241894 3.2418197,3.2418197 0 0 0 3.24128,3.24189 3.2418197,3.2418197 0 0 0 3.2419,-3.24189 3.2418197,3.2418197 0 0 0 -3.2419,-3.241894 z M 6.3588295,102.4152 12.11628,118.91824 H 0.6013793 Z m 28.0699935,6.85968 c -5.672686,0 -10.008958,5.01499 -10.008958,9.43212 v 13.57468 h 4.914291 V 118.707 c 0,-2.93016 2.758788,-4.95121 5.094667,-4.95121 2.335877,0 5.183641,2.02105 5.183641,4.95121 v 13.57468 h 4.914292 V 118.707 c 0,-4.41713 -4.425253,-9.43212 -10.097933,-9.43212 z m 64.245326,0.0957 c -6.960324,0 -11.911362,5.25827 -11.911362,11.74429 10e-7,6.48601 5.164095,11.7437 11.911362,11.7437 6.844111,0 11.761251,-5.25769 11.761251,-11.7437 0,-6.48602 -5.0474,-11.74429 -11.761251,-11.74429 z m -15.68409,0.0412 c -5.903261,0 -10.202647,4.2879 -10.202647,11.10271 v 11.7673 h 4.914291 v -11.7673 c 0,-2.24161 0.443963,-3.67435 1.855797,-5.08619 1.633364,-1.63337 3.230292,-1.78165 6.598795,-1.50776 v -4.08808 c -0.275569,-0.1591 -1.363832,-0.42068 -3.166236,-0.42068 z m 29.899151,0.55504 v 22.31497 h 4.91429 v -22.31497 z m -54.278733,3.82963 c 3.698501,-1.8e-4 6.560052,3.28355 6.560056,7.36993 2e-6,4.08638 -2.861551,7.35134 -6.560056,7.35116 -3.698269,-1.8e-4 -6.641166,-3.26504 -6.641163,-7.35116 2e-6,-4.08612 2.942898,-7.36975 6.641163,-7.36993 z m 73.340913,0 c 3.6985,-1.8e-4 6.56004,3.28355 6.56006,7.36993 0,4.08638 -2.86156,7.35134 -6.56006,7.35116 -3.69828,-1.8e-4 -6.64116,-3.26504 -6.64116,-7.35116 10e-6,-4.08612 2.94288,-7.36975 6.64116,-7.36993 z m -33.30811,0.004 c 3.93268,0 6.81125,3.27485 6.81125,7.31424 0,4.03938 -3.04881,7.31363 -6.81125,7.31363 -3.952258,0 -6.919594,-3.27425 -6.919594,-7.31363 0,-4.03939 2.842534,-7.31424 6.919594,-7.31424 z"/><g id="g42526" transform="matrix(1.1712938,0,0,1.1712938,-17.59766,-16.387895)"><g id="g28183"><path id="path7721" style="fill:url(#linearGradient41395);fill-opacity:1;stroke-width:8.245;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" d="m 157.35215,97.254529 c -1.2238,3e-6 -2.21588,0.992088 -2.21588,2.215885 6.4e-4,0.349325 0.0839,0.693546 0.24288,1.004586 l 4.25607,7.32359 3.03857,-0.36277 1.04335,-1.69395 -4.54959,-7.542696 c -0.41478,-0.592193 -1.09239,-0.944787 -1.8154,-0.944645 z"/><path style="mix-blend-mode:normal;fill:url(#linearGradient41397);fill-opacity:1;stroke:none;stroke-width:0.600001;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter25026)" d="m 155.13627,98.852496 c 1.26535,-0.92185 2.46098,-1.189321 3.6468,-0.446521 l 4.16719,7.821755 1.75286,-1.05833 -2.97656,-7.639845 -3.57187,-1.85829 -3.175,1.72599 z" id="path24395" clip-path="url(#clipPath25032)"/><path style="mix-blend-mode:normal;fill:url(#linearGradient41399);fill-opacity:1;stroke:none;stroke-width:0.600001;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter28167)" d="m 155.13627,98.852496 c 1.26535,-0.92185 2.46098,-1.189321 3.6468,-0.446521 l 4.16719,7.821755 1.75286,-1.05833 -2.97656,-7.639845 -3.57187,-1.85829 -3.175,1.72599 z" id="path28163" clip-path="url(#clipPath25032)"/><path id="path28171" style="fill:url(#linearGradient21709);fill-opacity:1;stroke-width:8.245;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" d="m 157.35215,97.254529 c -1.2238,3e-6 -2.21588,0.992088 -2.21588,2.215885 6.4e-4,0.349325 0.0839,0.693546 0.24288,1.004586 l 4.25607,7.32359 3.03857,-0.36277 1.04335,-1.69395 -4.54959,-7.542696 c -0.41478,-0.592193 -1.09239,-0.944787 -1.8154,-0.944645 z"/><path style="mix-blend-mode:normal;fill:url(#linearGradient41401);fill-opacity:1;stroke:none;stroke-width:0.600001;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter25026)" d="m 155.13627,98.852496 c 1.26535,-0.92185 2.46098,-1.189321 3.6468,-0.446521 l 4.16719,7.821755 1.75286,-1.05833 -2.97656,-7.639845 -3.57187,-1.85829 -3.175,1.72599 z" id="path28173" clip-path="url(#clipPath25032)"/><path style="mix-blend-mode:normal;fill:url(#linearGradient25401);fill-opacity:1;stroke:none;stroke-width:0.600001;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter28167)" d="m 155.13627,98.852496 c 1.26535,-0.92185 2.46098,-1.189321 3.6468,-0.446521 l 4.16719,7.821755 1.75286,-1.05833 -2.97656,-7.639845 -3.57187,-1.85829 -3.175,1.72599 z" id="path28175" clip-path="url(#clipPath25032)"/></g><path style="fill:url(#linearGradient41417);fill-opacity:1;stroke:none;stroke-width:0.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter40028)" d="m 163.44592,105.29223 -3.8107,2.50636 3.78673,0.85315 c 0.39619,-1.19744 1.72036,-2.58039 0.024,-3.35951 z" id="path39742" clip-path="url(#clipPath40046)"/><g id="g28927" transform="translate(-0.07422183)"><path id="path28185" style="fill:url(#linearGradient28199);fill-opacity:1;stroke-width:8.245;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" d="m 189.09733,97.254529 c 1.2238,3e-6 2.21588,0.992088 2.21588,2.215885 -6.4e-4,0.349325 -0.0839,0.693546 -0.24288,1.004586 l -4.25607,7.32359 -3.03857,-0.36277 -1.04335,-1.69395 4.54959,-7.542696 c 0.41478,-0.592193 1.09239,-0.944787 1.8154,-0.944645 z"/><path style="mix-blend-mode:normal;fill:url(#linearGradient28201);fill-opacity:1;stroke:none;stroke-width:0.600001;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter25026)" d="m 155.13627,98.852496 c 1.26535,-0.92185 2.46098,-1.189321 3.6468,-0.446521 l 4.16719,7.821755 1.75286,-1.05833 -2.97656,-7.639845 -3.57187,-1.85829 -3.175,1.72599 z" id="path28187" clip-path="url(#clipPath25032)" transform="matrix(-1,0,0,1,346.44948,0)"/><path style="mix-blend-mode:normal;fill:url(#linearGradient28203);fill-opacity:1;stroke:none;stroke-width:0.600001;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter28167)" d="m 155.13627,98.852496 c 1.26535,-0.92185 2.46098,-1.189321 3.6468,-0.446521 l 4.16719,7.821755 1.75286,-1.05833 -2.97656,-7.639845 -3.57187,-1.85829 -3.175,1.72599 z" id="path28189" clip-path="url(#clipPath25032)" transform="matrix(-1,0,0,1,346.44948,0)"/><path id="path28191" style="fill:url(#linearGradient28205);fill-opacity:1;stroke-width:8.245;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" d="m 189.09733,97.254529 c 1.2238,3e-6 2.21588,0.992088 2.21588,2.215885 -6.4e-4,0.349325 -0.0839,0.693546 -0.24288,1.004586 l -4.25607,7.32359 -3.03857,-0.36277 -1.04335,-1.69395 4.54959,-7.542696 c 0.41478,-0.592193 1.09239,-0.944787 1.8154,-0.944645 z"/><path style="mix-blend-mode:normal;fill:url(#linearGradient28207);fill-opacity:1;stroke:none;stroke-width:0.600001;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter25026)" d="m 155.13627,98.852496 c 1.26535,-0.92185 2.46098,-1.189321 3.6468,-0.446521 l 4.16719,7.821755 1.75286,-1.05833 -2.97656,-7.639845 -3.57187,-1.85829 -3.175,1.72599 z" id="path28193" clip-path="url(#clipPath25032)" transform="matrix(-1,0,0,1,346.44948,0)"/><path style="mix-blend-mode:normal;fill:url(#linearGradient28209);fill-opacity:1;stroke:none;stroke-width:0.600001;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter28167)" d="m 155.13627,98.852496 c 1.26535,-0.92185 2.46098,-1.189321 3.6468,-0.446521 l 4.16719,7.821755 1.75286,-1.05833 -2.97656,-7.639845 -3.57187,-1.85829 -3.175,1.72599 z" id="path28195" clip-path="url(#clipPath25032)" transform="matrix(-1,0,0,1,346.44948,0)"/></g><path style="fill:url(#linearGradient40082);fill-opacity:1;stroke:none;stroke-width:0.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter40500)" d="m 163.44592,105.29223 -3.8107,2.50636 3.78673,0.85315 c 0.39619,-1.19744 1.72036,-2.58039 0.024,-3.35951 z" id="path40074" clip-path="url(#clipPath40046)" transform="matrix(-1,0,0,1,346.37526,0)"/><path id="path7716" style="fill:url(#radialGradient15581);fill-opacity:1;stroke-width:11.0002;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" d="m 173.16979,103.93164 a 25.680634,25.680634 0 0 0 -25.52195,22.99601 h 51.06096 a 25.680634,25.680634 0 0 0 -25.53901,-22.99601 z"/><ellipse style="mix-blend-mode:normal;fill:url(#linearGradient38162);fill-opacity:1;stroke-width:8.94842;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers;filter:url(#filter37117)" id="ellipse36630" cx="-164.01886" cy="119.57114" rx="2.4496355" ry="2.7093031" transform="matrix(-1.0640424,0,0.18763785,1.0473673,-11.854534,-7.56809)"/><ellipse style="fill:url(#linearGradient42528);fill-opacity:1;stroke-width:8.94842;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" id="ellipse36208" cx="-164.01886" cy="119.57114" rx="2.4496355" ry="2.7093031" transform="matrix(-1,0,0.17634434,0.98432854,0,0)"/><path style="fill:url(#linearGradient18068);fill-opacity:1;stroke:none;stroke-width:0.600001;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter19184)" d="m 151.71217,115.53058 h 7.52208 c 2.4156,-2.75375 6.43874,-3.18627 12.20877,-3.18627 9.40435,0 12.45567,-1.38321 15.09387,3.18628 h 7.93144 c -1.69167,-6.3134 -11.73599,-10.92096 -21.29854,-10.92096 -10.25,0.15116 -19.98049,5.40824 -21.45762,10.92095 z" id="path16883" clip-path="url(#clipPath19190)"/><ellipse style="fill:url(#radialGradient13058);fill-opacity:1;stroke-width:8.97447;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" id="path8454" cx="186.11491" cy="120.26827" rx="2.4496355" ry="2.7250993" transform="matrix(1,0,-0.20566317,0.97862284,0,0)"/><path style="fill:#a7d5aa;fill-opacity:1;stroke:none;stroke-width:0.600001;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter17368)" d="m 151.43817,115.03043 h 7.59046 c 2.43756,-2.77879 8.00929,-2.68612 12.87359,-2.68612 7.92813,0 12.01509,-1.9249 14.67728,2.68613 h 8.00356 c -1.70706,-6.3708 -11.85072,-10.42081 -21.41327,-10.42081 -10.25,0.15116 -20.24106,4.85797 -21.73162,10.4208 z" id="path19040" transform="matrix(0.70801614,0,0,0.70801614,50.598142,30.544324)" clip-path="url(#clipPath19198)"/><ellipse style="fill:url(#linearGradient29430);fill-opacity:1;stroke-width:8.94842;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers" id="ellipse8456" cx="-164.01886" cy="119.57114" rx="2.4496355" ry="2.7093031" transform="matrix(-1,0,0.17634434,0.98432854,0,0)"/><path style="fill:#083e15;fill-opacity:1;stroke:none;stroke-width:0.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter31284)" d="m 186.577,120.11489 c 0.40134,-0.41767 0.94893,-1.4441 0.815,-1.67607 0.48981,-2.29198 -1.32635,-3.17621 -2.76522,-3.40838 l 3.5085,-0.20127 c 0,0 0.77859,2.36644 0.82683,2.53007 0.33884,1.14927 -0.95059,2.37127 -2.38511,2.75565 z" id="path31282" clip-path="url(#clipPath32049)"/><path style="mix-blend-mode:normal;fill:#445747;fill-opacity:1;stroke:none;stroke-width:0.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter32602)" d="m 185.23314,115.76888 c -0.57707,-0.24133 -1.23556,-0.31602 -1.96853,-0.23829 0.71506,-0.25462 1.33009,-0.49992 1.96853,0.23829 z" id="path32109"/><path style="mix-blend-mode:normal;fill:#375f40;fill-opacity:1;stroke:none;stroke-width:0.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter33138)" d="m 183.81543,115.19227 c 1.10912,-0.45363 1.92347,0.23366 2.78966,0.72034 l -0.18133,-1.1992 -2.67064,0.11576 z" id="path32660" clip-path="url(#clipPath33144)"/><path id="path34195" style="color:#000000;mix-blend-mode:normal;fill:#afb4ad;fill-opacity:1;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers;filter:url(#filter34203)" d="m 185.54669,115.72927 c -0.0149,-3.3e-4 -0.0298,0.001 -0.0444,0.004 -0.0521,0.0106 -0.0978,0.0414 -0.12713,0.0858 -0.0615,0.0918 -0.037,0.21602 0.0548,0.27751 0.33366,0.22303 0.52573,0.45776 0.68368,0.67747 0.0647,0.0894 0.18955,0.10955 0.27905,0.045 0.0888,-0.0639 0.10973,-0.18734 0.047,-0.27698 -0.16985,-0.23628 -0.40327,-0.52121 -0.78703,-0.77773 -0.0313,-0.0213 -0.0681,-0.0333 -0.10594,-0.0346 z m -24.73389,0.0584 c -0.0377,8.2e-4 -0.0745,0.0123 -0.10594,0.0331 -0.38377,0.25652 -0.61718,0.54093 -0.78703,0.77721 -0.0649,0.0896 -0.0447,0.21487 0.045,0.27957 0.0896,0.0649 0.21487,0.0447 0.27957,-0.045 0.15794,-0.21971 0.35158,-0.45497 0.68523,-0.67799 0.0915,-0.0615 0.11596,-0.18533 0.0548,-0.27699 -0.0293,-0.0444 -0.075,-0.0752 -0.12712,-0.0858 v -5.2e-4 c -0.0146,-0.003 -0.0295,-0.004 -0.0444,-0.004 z m 1.89825,2.66855 c 0.0376,-0.0376 -0.1041,0.0212 -0.14159,0.0589 -0.17025,0.17007 -0.33902,0.2726 -0.52762,0.38499 -0.0947,0.0562 -0.12614,0.17844 -0.0703,0.27337 0.0563,0.096 0.18005,0.12755 0.27544,0.0703 0.18947,-0.11291 0.39782,-0.23785 0.60565,-0.44545 0.0783,-0.0781 0.0783,-0.20504 0,-0.28319 -0.0375,-0.0377 -0.1792,-0.0213 -0.1416,-0.0589 z m 20.99131,-0.009 c -0.0531,4e-5 -0.1041,0.0212 -0.1416,0.0589 -0.0783,0.0781 -0.0783,0.20505 0,0.28319 0.20783,0.2076 0.41772,0.33254 0.6072,0.44545 0.0949,0.0558 0.21715,0.0244 0.27337,-0.0703 0.0558,-0.0949 0.0244,-0.21715 -0.0703,-0.27337 -0.1886,-0.11239 -0.35685,-0.21492 -0.5271,-0.38499 -0.0375,-0.0377 -0.0884,-0.0589 -0.14159,-0.0589 z"/><path id="path39682" style="color:#000000;mix-blend-mode:normal;fill:#afb4ad;fill-opacity:1;stroke-linecap:round;stroke-linejoin:round;paint-order:stroke fill markers;filter:url(#filter39686)" d="m 185.54669,115.72927 c -0.0149,-3.3e-4 -0.0298,0.001 -0.0444,0.004 -0.0521,0.0106 -0.0978,0.0414 -0.12713,0.0858 -0.0615,0.0918 -0.037,0.21602 0.0548,0.27751 0.33366,0.22303 0.52573,0.45776 0.68368,0.67747 0.0647,0.0894 0.18955,0.10955 0.27905,0.045 0.0888,-0.0639 0.10973,-0.18734 0.047,-0.27698 -0.16985,-0.23628 -0.40327,-0.52121 -0.78703,-0.77773 -0.0313,-0.0213 -0.0681,-0.0333 -0.10594,-0.0346 z m -24.73389,0.0584 c -0.0377,8.2e-4 -0.0745,0.0123 -0.10594,0.0331 -0.38377,0.25652 -0.61718,0.54093 -0.78703,0.77721 -0.0649,0.0896 -0.0447,0.21487 0.045,0.27957 0.0896,0.0649 0.21487,0.0447 0.27957,-0.045 0.15794,-0.21971 0.35158,-0.45497 0.68523,-0.67799 0.0915,-0.0615 0.11596,-0.18533 0.0548,-0.27699 -0.0293,-0.0444 -0.075,-0.0752 -0.12712,-0.0858 v -5.2e-4 c -0.0146,-0.003 -0.0295,-0.004 -0.0444,-0.004 z m 1.89825,2.66855 c 0.0376,-0.0376 -0.1041,0.0212 -0.14159,0.0589 -0.17025,0.17007 -0.33902,0.2726 -0.52762,0.38499 -0.0947,0.0562 -0.12614,0.17844 -0.0703,0.27337 0.0563,0.096 0.18005,0.12755 0.27544,0.0703 0.18947,-0.11291 0.39782,-0.23785 0.60565,-0.44545 0.0783,-0.0781 0.0783,-0.20504 0,-0.28319 -0.0375,-0.0377 -0.1792,-0.0213 -0.1416,-0.0589 z m 20.99131,-0.009 c -0.0531,4e-5 -0.1041,0.0212 -0.1416,0.0589 -0.0783,0.0781 -0.0783,0.20505 0,0.28319 0.20783,0.2076 0.41772,0.33254 0.6072,0.44545 0.0949,0.0558 0.21715,0.0244 0.27337,-0.0703 0.0558,-0.0949 0.0244,-0.21715 -0.0703,-0.27337 -0.1886,-0.11239 -0.35685,-0.21492 -0.5271,-0.38499 -0.0375,-0.0377 -0.0884,-0.0589 -0.14159,-0.0589 z"/><path style="mix-blend-mode:normal;fill:url(#linearGradient42530);fill-opacity:1;stroke:none;stroke-width:0.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter41256)" d="m 163.71714,105.74187 c -3.0186,1.68048 -6.86549,3.87094 -9.68304,7.40703 l -0.20046,-3.7488 z" id="path40556" clip-path="url(#clipPath41262)"/><path style="mix-blend-mode:normal;fill:url(#linearGradient42532);fill-opacity:1;stroke:none;stroke-width:0.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter41272)" d="m 163.71714,105.74187 c -3.0186,1.68048 -6.86549,3.87094 -9.68304,7.40703 l -0.20046,-3.7488 z" id="path41268" clip-path="url(#clipPath41262)"/><path style="mix-blend-mode:normal;fill:url(#linearGradient42534);fill-opacity:1;stroke:none;stroke-width:0.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter41256)" d="m 163.71714,105.74187 c -3.0186,1.68048 -6.86549,3.87094 -9.68304,7.40703 l -0.20046,-3.7488 z" id="path41276" clip-path="url(#clipPath41262)"/><path style="mix-blend-mode:normal;fill:url(#linearGradient40564);fill-opacity:1;stroke:none;stroke-width:0.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter41272)" d="m 163.71714,105.74187 c -3.0186,1.68048 -6.86549,3.87094 -9.68304,7.40703 l -0.20046,-3.7488 z" id="path41278" clip-path="url(#clipPath41262)"/><path style="mix-blend-mode:normal;fill:url(#linearGradient41294);fill-opacity:1;stroke:none;stroke-width:0.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter41256)" d="m 163.71714,105.74187 c -3.0186,1.68048 -6.86549,3.87094 -9.68304,7.40703 l -0.20046,-3.7488 z" id="path41288" clip-path="url(#clipPath41262)" transform="matrix(-1,0,0,1,346.37574,0)"/><path style="mix-blend-mode:normal;fill:url(#linearGradient41292);fill-opacity:1;stroke:none;stroke-width:0.4;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:none;stroke-opacity:1;paint-order:stroke fill markers;filter:url(#filter41272)" d="m 163.71714,105.74187 c -3.0186,1.68048 -6.86549,3.87094 -9.68304,7.40703 l -0.20046,-3.7488 z" id="path41290" clip-path="url(#clipPath41262)" transform="matrix(-1,0,0,1,346.37574,0)"/></g></g></g></svg>
                </div>
                <div class="pl-8">Android</div>
            </div>
            </a>
            
            <a href="/docs/sdks/analytics/browser">
            <div
                class="border border-amp-gray-100 rounded h-24 w-64 p-4 hover:shadow-lg transition-shadow flex items-center">
                <div><svg class="h-12 w-12 max-w-12 max-h-12" xmlns="http://www.w3.org/2000/svg" width="2500" height="2500" viewBox="0 0 1052 1052"><path fill="#f0db4f" d="M0 0h1052v1052H0z"/><path d="M965.9 801.1c-7.7-48-39-88.3-131.7-125.9-32.2-14.8-68.1-25.399-78.8-49.8-3.8-14.2-4.3-22.2-1.9-30.8 6.9-27.9 40.2-36.6 66.6-28.6 17 5.7 33.1 18.801 42.8 39.7 45.4-29.399 45.3-29.2 77-49.399-11.6-18-17.8-26.301-25.4-34-27.3-30.5-64.5-46.2-124-45-10.3 1.3-20.699 2.699-31 4-29.699 7.5-58 23.1-74.6 44-49.8 56.5-35.6 155.399 25 196.1 59.7 44.8 147.4 55 158.6 96.9 10.9 51.3-37.699 67.899-86 62-35.6-7.4-55.399-25.5-76.8-58.4-39.399 22.8-39.399 22.8-79.899 46.1 9.6 21 19.699 30.5 35.8 48.7 76.2 77.3 266.899 73.5 301.1-43.5 1.399-4.001 10.6-30.801 3.199-72.101zm-394-317.6h-98.4c0 85-.399 169.4-.399 254.4 0 54.1 2.8 103.7-6 118.9-14.4 29.899-51.7 26.2-68.7 20.399-17.3-8.5-26.1-20.6-36.3-37.699-2.8-4.9-4.9-8.7-5.601-9-26.699 16.3-53.3 32.699-80 49 13.301 27.3 32.9 51 58 66.399 37.5 22.5 87.9 29.4 140.601 17.3 34.3-10 63.899-30.699 79.399-62.199 22.4-41.3 17.6-91.3 17.4-146.6.5-90.2 0-180.4 0-270.9z" fill="#323330"/></svg>
                </div>
                <div class="pl-8">Browser</div>
            </div>
            </a>
            
            <a href="/docs/sdks/analytics/flutter">
            <div
                class="border border-amp-gray-100 rounded h-24 w-64 p-4 hover:shadow-lg transition-shadow flex items-center">
                <div><svg class="h-12 w-12 max-w-12 max-h-12" xmlns="http://www.w3.org/2000/svg" viewBox="-2 0 24 24"><title>Flutter icon</title><path d="M14.314 0L2.3 12 6 15.7 21.684.012h-7.357L14.314 0zm.014 11.072l-6.471 6.457 6.47 6.47H21.7l-6.46-6.468 6.46-6.46h-7.371z"/></svg>
                </div>
                <div class="pl-8">Flutter</div>
            </div>
            </a>
            
            <a href="/docs/sdks/analytics/go">
            <div
                class="border border-amp-gray-100 rounded h-24 w-64 p-4 hover:shadow-lg transition-shadow flex items-center">
                <div><svg class="h-12 w-12 max-w-12 max-h-12" xmlns="http://www.w3.org/2000/svg" fill="#00ADD8" viewBox="0 0 24 24"><title>Go</title><path d="M1.811 10.231c-.047 0-.058-.023-.035-.059l.246-.315c.023-.035.081-.058.128-.058h4.172c.046 0 .058.035.035.07l-.199.303c-.023.036-.082.07-.117.07zM.047 11.306c-.047 0-.059-.023-.035-.058l.245-.316c.023-.035.082-.058.129-.058h5.328c.047 0 .07.035.058.07l-.093.28c-.012.047-.058.07-.105.07zm2.828 1.075c-.047 0-.059-.035-.035-.07l.163-.292c.023-.035.07-.07.117-.07h2.337c.047 0 .07.035.07.082l-.023.28c0 .047-.047.082-.082.082zm12.129-2.36c-.736.187-1.239.327-1.963.514-.176.046-.187.058-.34-.117-.174-.199-.303-.327-.548-.444-.737-.362-1.45-.257-2.115.175-.795.514-1.204 1.274-1.192 2.22.011.935.654 1.706 1.577 1.835.795.105 1.46-.175 1.987-.77.105-.13.198-.27.315-.434H10.47c-.245 0-.304-.152-.222-.35.152-.362.432-.97.596-1.274a.315.315 0 01.292-.187h4.253c-.023.316-.023.631-.07.947a4.983 4.983 0 01-.958 2.29c-.841 1.11-1.94 1.8-3.33 1.986-1.145.152-2.209-.07-3.143-.77-.865-.655-1.356-1.52-1.484-2.595-.152-1.274.222-2.419.993-3.424.83-1.086 1.928-1.776 3.272-2.02 1.098-.2 2.15-.07 3.096.571.62.41 1.063.97 1.356 1.648.07.105.023.164-.117.2m3.868 6.461c-1.064-.024-2.034-.328-2.852-1.029a3.665 3.665 0 01-1.262-2.255c-.21-1.32.152-2.489.947-3.529.853-1.122 1.881-1.706 3.272-1.95 1.192-.21 2.314-.095 3.33.595.923.63 1.496 1.484 1.648 2.605.198 1.578-.257 2.863-1.344 3.962-.771.783-1.718 1.273-2.805 1.495-.315.06-.63.07-.934.106zm2.78-4.72c-.011-.153-.011-.27-.034-.387-.21-1.157-1.274-1.81-2.384-1.554-1.087.245-1.788.935-2.045 2.033-.21.912.234 1.835 1.075 2.21.643.28 1.285.244 1.905-.07.923-.48 1.425-1.228 1.484-2.233z"/></svg>
                </div>
                <div class="pl-8">Go</div>
            </div>
            </a>
            
            <a href="/docs/sdks/analytics/ios">
            <div
                class="border border-amp-gray-100 rounded h-24 w-64 p-4 hover:shadow-lg transition-shadow flex items-center">
                <div><?xml version="1.0" encoding="UTF-8" standalone="no"?><svg class="h-12 w-12 max-w-12 max-h-12" xmlns="http://www.w3.org/2000/svg" xmlns:svg="http://www.w3.org/2000/svg" version="1.1" viewBox="0 0 117.6206 58.359901" id="svg4" width="117.6206" height="58.359901"><defs id="defs8"/><path d="m 0.5468,57.4219 h 9.7266 V 16.0159 H 0.5468 Z m 4.8438,-46.836 c 3.0469,0 5.4297,-2.3438 5.4297,-5.2734 C 10.8203,2.3437 8.4375,0 5.3906,0 2.3828,0 0,2.3438 0,5.3125 c 0,2.9297 2.3828,5.2734 5.3906,5.2734 z m 37.267,-10.469 c -16.445,0 -26.758,11.211 -26.758,29.141 0,17.93 10.312,29.102 26.758,29.102 16.406,0 26.719,-11.172 26.719,-29.102 0,-17.93 -10.312,-29.141 -26.719,-29.141 z m 0,8.5938 c 10.039,0 16.445,7.9688 16.445,20.547 0,12.539 -6.4062,20.508 -16.445,20.508 -10.078,0 -16.445,-7.9688 -16.445,-20.508 0,-12.578 6.3672,-20.547 16.445,-20.547 z m 30.822,32.852 c 0.42969,10.391 8.9453,16.797 21.914,16.797 13.633,0 22.227,-6.7188 22.227,-17.422 0,-8.3984 -4.8438,-13.125 -16.289,-15.742 l -6.4844,-1.4844 c -6.9141,-1.6406 -9.7656,-3.8281 -9.7656,-7.5781 0,-4.6875 4.2969,-7.8125 10.664,-7.8125 6.4453,0 10.859,3.1641 11.328,8.4375 h 9.6094 c -0.23438,-9.9219 -8.4375,-16.641 -20.859,-16.641 -12.266,0 -20.977,6.7578 -20.977,16.758 0,8.0469 4.9219,13.047 15.312,15.43 l 7.3047,1.7188 c 7.1094,1.6797 10,4.0234 10,8.0859 0,4.6875 -4.7266,8.0469 -11.523,8.0469 -6.875,0 -12.07,-3.3984 -12.695,-8.5938 h -9.7656 z" id="path2"/></svg>
                </div>
                <div class="pl-8">iOS</div>
            </div>
            </a>
            
            <a href="/docs/sdks/analytics/java">
            <div
                class="border border-amp-gray-100 rounded h-24 w-64 p-4 hover:shadow-lg transition-shadow flex items-center">
                <div><svg class="h-12 w-12 max-w-12 max-h-12" xmlns="http://www.w3.org/2000/svg" width="1344" height="2500" viewBox="6.527 4.399 290.829 540.906"><path d="M285.104 430.945h-2.037v-1.14h5.486v1.14h-2.025v5.688h-1.424v-5.688zm10.942.297h-.032l-2.02 5.393h-.924l-2.006-5.393h-.024v5.393h-1.343v-6.828h1.976l1.86 4.835 1.854-4.835h1.969v6.828h-1.311l.001-5.393z" fill="#e76f00"/><path d="M102.681 291.324s-14.178 8.245 10.09 11.035c29.4 3.354 44.426 2.873 76.825-3.259 0 0 8.518 5.341 20.414 9.967-72.63 31.128-164.376-1.803-107.329-17.743M93.806 250.704s-15.902 11.771 8.384 14.283c31.406 3.24 56.208 3.505 99.125-4.759 0 0 5.937 6.018 15.271 9.309-87.815 25.678-185.624 2.025-122.78-18.833" fill="#5382a1"/><path d="M168.625 181.799c17.896 20.604-4.701 39.146-4.701 39.146s45.439-23.458 24.571-52.833c-19.491-27.395-34.438-41.005 46.479-87.934.001-.001-127.013 31.721-66.349 101.621" fill="#e76f00"/><path d="M264.684 321.369s10.492 8.646-11.555 15.333c-41.923 12.7-174.488 16.535-211.314.507-13.238-5.76 11.587-13.752 19.396-15.429 8.144-1.766 12.798-1.437 12.798-1.437-14.722-10.371-95.157 20.363-40.857 29.166 148.084 24.015 269.944-10.814 231.532-28.14M109.499 208.617s-67.431 16.016-23.879 21.832c18.389 2.462 55.047 1.905 89.192-.956 27.906-2.354 55.928-7.358 55.928-7.358s-9.84 4.214-16.959 9.074c-68.475 18.01-200.756 9.631-162.674-8.79 32.206-15.568 58.392-13.802 58.392-13.802M230.462 276.231c69.608-36.171 37.425-70.932 14.96-66.248-5.506 1.146-7.961 2.139-7.961 2.139s2.045-3.202 5.947-4.588c44.441-15.624 78.619 46.081-14.346 70.521 0 0 1.079-.962 1.4-1.824" fill="#5382a1"/><path d="M188.495 4.399s38.55 38.562-36.563 97.862c-60.233 47.567-13.735 74.689-.025 105.678-35.158-31.723-60.96-59.647-43.65-85.637 25.406-38.151 95.792-56.648 80.238-117.903" fill="#e76f00"/><path d="M116.339 374.246c66.815 4.277 169.417-2.373 171.846-33.987 0 0-4.67 11.984-55.219 21.503-57.027 10.731-127.364 9.479-169.081 2.601.002-.002 8.541 7.067 52.454 9.883" fill="#5382a1"/><path d="M105.389 495.049c-6.303 5.467-12.96 8.536-18.934 8.536-8.527 0-13.134-5.113-13.134-13.314 0-8.871 4.937-15.357 24.739-15.357h7.328l.001 20.135m17.392 19.623V453.93c0-15.518-8.85-25.756-30.188-25.756-12.457 0-23.369 3.076-32.238 6.999l2.56 10.752c6.983-2.563 16.022-4.949 24.894-4.949 12.292 0 17.58 4.949 17.58 15.181v7.678h-6.135c-29.865 0-43.337 11.593-43.337 28.993 0 15.018 8.878 23.554 25.594 23.554 10.745 0 18.766-4.437 26.264-10.929l1.361 9.221 13.645-.002zM180.824 514.672h-21.691l-26.106-84.96h18.944l16.198 52.199 3.601 15.699c8.195-22.698 13.992-45.726 16.891-67.898h18.427c-4.938 27.976-13.822 58.684-26.264 84.96M264.038 495.049c-6.315 5.467-12.983 8.536-18.958 8.536-8.512 0-13.131-5.113-13.131-13.314 0-8.871 4.947-15.357 24.748-15.357h7.341v20.135m17.39 19.623V453.93c0-15.518-8.871-25.756-30.186-25.756-12.465 0-23.381 3.076-32.246 6.999l2.557 10.752c6.985-2.563 16.041-4.949 24.906-4.949 12.283 0 17.579 4.949 17.579 15.181v7.678h-6.146c-29.873 0-43.34 11.593-43.34 28.993 0 15.018 8.871 23.554 25.584 23.554 10.752 0 18.77-4.437 26.28-10.929l1.366 9.221 13.646-.002zM36.847 529.099c-4.958 7.239-12.966 12.966-21.733 16.206L6.527 535.2c6.673-3.424 12.396-8.954 15.055-14.104 2.3-4.581 3.252-10.485 3.252-24.604v-96.995h18.478v95.666c-.001 18.875-1.51 26.5-6.465 33.936" fill="#e76f00"/></svg>
                </div>
                <div class="pl-8">JRE Java</div>
            </div>
            </a>
            
            <a href="/docs/sdks/analytics/node">
            <div
                class="border border-amp-gray-100 rounded h-24 w-64 p-4 hover:shadow-lg transition-shadow flex items-center">
                <div><svg class="h-12 w-12 max-w-12 max-h-12" xmlns="http://www.w3.org/2000/svg" width="2270" height="2500" viewBox="0 0 256 282" preserveAspectRatio="xMinYMin meet"><g fill="#8CC84B"><path d="M116.504 3.58c6.962-3.985 16.03-4.003 22.986 0 34.995 19.774 70.001 39.517 104.99 59.303 6.581 3.707 10.983 11.031 10.916 18.614v118.968c.049 7.897-4.788 15.396-11.731 19.019-34.88 19.665-69.742 39.354-104.616 59.019-7.106 4.063-16.356 3.75-23.24-.646-10.457-6.062-20.932-12.094-31.39-18.15-2.137-1.274-4.546-2.288-6.055-4.36 1.334-1.798 3.719-2.022 5.657-2.807 4.365-1.388 8.374-3.616 12.384-5.778 1.014-.694 2.252-.428 3.224.193 8.942 5.127 17.805 10.403 26.777 15.481 1.914 1.105 3.852-.362 5.488-1.274 34.228-19.345 68.498-38.617 102.72-57.968 1.268-.61 1.969-1.956 1.866-3.345.024-39.245.006-78.497.012-117.742.145-1.576-.767-3.025-2.192-3.67-34.759-19.575-69.5-39.18-104.253-58.76a3.621 3.621 0 0 0-4.094-.006C91.2 39.257 56.465 58.88 21.712 78.454c-1.42.646-2.373 2.071-2.204 3.653.006 39.245 0 78.497 0 117.748a3.329 3.329 0 0 0 1.89 3.303c9.274 5.259 18.56 10.481 27.84 15.722 5.228 2.814 11.647 4.486 17.407 2.33 5.083-1.823 8.646-7.01 8.549-12.407.048-39.016-.024-78.038.036-117.048-.127-1.732 1.516-3.163 3.2-3 4.456-.03 8.918-.06 13.374.012 1.86-.042 3.14 1.823 2.91 3.568-.018 39.263.048 78.527-.03 117.79.012 10.464-4.287 21.85-13.966 26.97-11.924 6.177-26.662 4.867-38.442-1.056-10.198-5.09-19.93-11.097-29.947-16.55C5.368 215.886.555 208.357.604 200.466V81.497c-.073-7.74 4.504-15.197 11.29-18.85C46.768 42.966 81.636 23.27 116.504 3.58z"/><path d="M146.928 85.99c15.21-.979 31.493-.58 45.18 6.913 10.597 5.742 16.472 17.793 16.659 29.566-.296 1.588-1.956 2.464-3.472 2.355-4.413-.006-8.827.06-13.24-.03-1.872.072-2.96-1.654-3.195-3.309-1.268-5.633-4.34-11.212-9.642-13.929-8.139-4.075-17.576-3.87-26.451-3.785-6.479.344-13.446.905-18.935 4.715-4.214 2.886-5.494 8.712-3.99 13.404 1.418 3.369 5.307 4.456 8.489 5.458 18.33 4.794 37.754 4.317 55.734 10.626 7.444 2.572 14.726 7.572 17.274 15.366 3.333 10.446 1.872 22.932-5.56 31.318-6.027 6.901-14.805 10.657-23.56 12.697-11.647 2.597-23.734 2.663-35.562 1.51-11.122-1.268-22.696-4.19-31.282-11.768-7.342-6.375-10.928-16.308-10.572-25.895.085-1.619 1.697-2.748 3.248-2.615 4.444-.036 8.888-.048 13.332.006 1.775-.127 3.091 1.407 3.182 3.08.82 5.367 2.837 11 7.517 14.182 9.032 5.827 20.365 5.428 30.707 5.591 8.568-.38 18.186-.495 25.178-6.158 3.689-3.23 4.782-8.634 3.785-13.283-1.08-3.925-5.186-5.754-8.712-6.95-18.095-5.724-37.736-3.647-55.656-10.12-7.275-2.571-14.31-7.432-17.105-14.906-3.9-10.578-2.113-23.662 6.098-31.765 8.006-8.06 19.563-11.164 30.551-12.275z"/></g></svg>
                </div>
                <div class="pl-8">Node.js</div>
            </div>
            </a>
            
            <a href="/docs/sdks/analytics/python">
            <div
                class="border border-amp-gray-100 rounded h-24 w-64 p-4 hover:shadow-lg transition-shadow flex items-center">
                <div><svg class="h-12 w-12 max-w-12 max-h-12" xmlns="http://www.w3.org/2000/svg" width="2500" height="2490" viewBox="0 0 256 255" preserveAspectRatio="xMinYMin meet"><defs><linearGradient x1="12.959%" y1="12.039%" x2="79.639%" y2="78.201%" id="a"><stop stop-color="#387EB8" offset="0%"/><stop stop-color="#366994" offset="100%"/></linearGradient><linearGradient x1="19.128%" y1="20.579%" x2="90.742%" y2="88.429%" id="b"><stop stop-color="#FFE052" offset="0%"/><stop stop-color="#FFC331" offset="100%"/></linearGradient></defs><path d="M126.916.072c-64.832 0-60.784 28.115-60.784 28.115l.072 29.128h61.868v8.745H41.631S.145 61.355.145 126.77c0 65.417 36.21 63.097 36.21 63.097h21.61v-30.356s-1.165-36.21 35.632-36.21h61.362s34.475.557 34.475-33.319V33.97S194.67.072 126.916.072zM92.802 19.66a11.12 11.12 0 0 1 11.13 11.13 11.12 11.12 0 0 1-11.13 11.13 11.12 11.12 0 0 1-11.13-11.13 11.12 11.12 0 0 1 11.13-11.13z" fill="url(#a)"/><path d="M128.757 254.126c64.832 0 60.784-28.115 60.784-28.115l-.072-29.127H127.6v-8.745h86.441s41.486 4.705 41.486-60.712c0-65.416-36.21-63.096-36.21-63.096h-21.61v30.355s1.165 36.21-35.632 36.21h-61.362s-34.475-.557-34.475 33.32v56.013s-5.235 33.897 62.518 33.897zm34.114-19.586a11.12 11.12 0 0 1-11.13-11.13 11.12 11.12 0 0 1 11.13-11.131 11.12 11.12 0 0 1 11.13 11.13 11.12 11.12 0 0 1-11.13 11.13z" fill="url(#b)"/></svg>
                </div>
                <div class="pl-8">Python</div>
            </div>
            </a>
            
            <a href="/docs/sdks/analytics/react-native">
            <div
                class="border border-amp-gray-100 rounded h-24 w-64 p-4 hover:shadow-lg transition-shadow flex items-center">
                <div><svg class="h-12 w-12 max-w-12 max-h-12" xmlns="http://www.w3.org/2000/svg" height="2500" viewBox="175.7 78 490.6 436.9" width="2194"><g fill="#61dafb"><path d="m666.3 296.5c0-32.5-40.7-63.3-103.1-82.4 14.4-63.6 8-114.2-20.2-130.4-6.5-3.8-14.1-5.6-22.4-5.6v22.3c4.6 0 8.3.9 11.4 2.6 13.6 7.8 19.5 37.5 14.9 75.7-1.1 9.4-2.9 19.3-5.1 29.4-19.6-4.8-41-8.5-63.5-10.9-13.5-18.5-27.5-35.3-41.6-50 32.6-30.3 63.2-46.9 84-46.9v-22.3c-27.5 0-63.5 19.6-99.9 53.6-36.4-33.8-72.4-53.2-99.9-53.2v22.3c20.7 0 51.4 16.5 84 46.6-14 14.7-28 31.4-41.3 49.9-22.6 2.4-44 6.1-63.6 11-2.3-10-4-19.7-5.2-29-4.7-38.2 1.1-67.9 14.6-75.8 3-1.8 6.9-2.6 11.5-2.6v-22.3c-8.4 0-16 1.8-22.6 5.6-28.1 16.2-34.4 66.7-19.9 130.1-62.2 19.2-102.7 49.9-102.7 82.3 0 32.5 40.7 63.3 103.1 82.4-14.4 63.6-8 114.2 20.2 130.4 6.5 3.8 14.1 5.6 22.5 5.6 27.5 0 63.5-19.6 99.9-53.6 36.4 33.8 72.4 53.2 99.9 53.2 8.4 0 16-1.8 22.6-5.6 28.1-16.2 34.4-66.7 19.9-130.1 62-19.1 102.5-49.9 102.5-82.3zm-130.2-66.7c-3.7 12.9-8.3 26.2-13.5 39.5-4.1-8-8.4-16-13.1-24-4.6-8-9.5-15.8-14.4-23.4 14.2 2.1 27.9 4.7 41 7.9zm-45.8 106.5c-7.8 13.5-15.8 26.3-24.1 38.2-14.9 1.3-30 2-45.2 2-15.1 0-30.2-.7-45-1.9-8.3-11.9-16.4-24.6-24.2-38-7.6-13.1-14.5-26.4-20.8-39.8 6.2-13.4 13.2-26.8 20.7-39.9 7.8-13.5 15.8-26.3 24.1-38.2 14.9-1.3 30-2 45.2-2 15.1 0 30.2.7 45 1.9 8.3 11.9 16.4 24.6 24.2 38 7.6 13.1 14.5 26.4 20.8 39.8-6.3 13.4-13.2 26.8-20.7 39.9zm32.3-13c5.4 13.4 10 26.8 13.8 39.8-13.1 3.2-26.9 5.9-41.2 8 4.9-7.7 9.8-15.6 14.4-23.7 4.6-8 8.9-16.1 13-24.1zm-101.4 106.7c-9.3-9.6-18.6-20.3-27.8-32 9 .4 18.2.7 27.5.7 9.4 0 18.7-.2 27.8-.7-9 11.7-18.3 22.4-27.5 32zm-74.4-58.9c-14.2-2.1-27.9-4.7-41-7.9 3.7-12.9 8.3-26.2 13.5-39.5 4.1 8 8.4 16 13.1 24s9.5 15.8 14.4 23.4zm73.9-208.1c9.3 9.6 18.6 20.3 27.8 32-9-.4-18.2-.7-27.5-.7-9.4 0-18.7.2-27.8.7 9-11.7 18.3-22.4 27.5-32zm-74 58.9c-4.9 7.7-9.8 15.6-14.4 23.7-4.6 8-8.9 16-13 24-5.4-13.4-10-26.8-13.8-39.8 13.1-3.1 26.9-5.8 41.2-7.9zm-90.5 125.2c-35.4-15.1-58.3-34.9-58.3-50.6s22.9-35.6 58.3-50.6c8.6-3.7 18-7 27.7-10.1 5.7 19.6 13.2 40 22.5 60.9-9.2 20.8-16.6 41.1-22.2 60.6-9.9-3.1-19.3-6.5-28-10.2zm53.8 142.9c-13.6-7.8-19.5-37.5-14.9-75.7 1.1-9.4 2.9-19.3 5.1-29.4 19.6 4.8 41 8.5 63.5 10.9 13.5 18.5 27.5 35.3 41.6 50-32.6 30.3-63.2 46.9-84 46.9-4.5-.1-8.3-1-11.3-2.7zm237.2-76.2c4.7 38.2-1.1 67.9-14.6 75.8-3 1.8-6.9 2.6-11.5 2.6-20.7 0-51.4-16.5-84-46.6 14-14.7 28-31.4 41.3-49.9 22.6-2.4 44-6.1 63.6-11 2.3 10.1 4.1 19.8 5.2 29.1zm38.5-66.7c-8.6 3.7-18 7-27.7 10.1-5.7-19.6-13.2-40-22.5-60.9 9.2-20.8 16.6-41.1 22.2-60.6 9.9 3.1 19.3 6.5 28.1 10.2 35.4 15.1 58.3 34.9 58.3 50.6-.1 15.7-23 35.6-58.4 50.6z"/><circle cx="420.9" cy="296.5" r="45.7"/></g></svg>
                </div>
                <div class="pl-8">React Native</div>
            </div>
            </a>
            
            <a href="/docs/sdks/analytics/unity">
            <div
                class="border border-amp-gray-100 rounded h-24 w-64 p-4 hover:shadow-lg transition-shadow flex items-center">
                <div><svg class="h-12 w-12 max-w-12 max-h-12" xmlns="http://www.w3.org/2000/svg" width="2433" height="2500" viewBox="0 0 256 263" preserveAspectRatio="xMinYMin meet"><path d="M166.872 131.237l45.91-79.275 22.184 79.275-22.185 79.256-45.909-79.256zm-22.376 12.874l45.916 79.262-79.966-20.486-57.77-58.776h91.82zm45.906-105.033l-45.906 79.275h-91.82l57.77-58.78 79.956-20.495zm65.539 65.18L227.933.06l-104.54 27.925-15.475 27.207-31.401-.225L0 131.244l76.517 76.259h.003l31.388-.232 15.497 27.207 104.528 27.92L255.94 158.22l-15.906-26.982 15.906-26.978z" fill="#222C37"/></svg>
                </div>
                <div class="pl-8">Unity</div>
            </div>
            </a>
            
            <a href="/docs/sdks/analytics/unreal">
            <div
                class="border border-amp-gray-100 rounded h-24 w-64 p-4 hover:shadow-lg transition-shadow flex items-center">
                <div><svg class="h-12 w-12 max-w-12 max-h-12" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 210.4 210.4" width="2500" height="2500"><path d="M105.2 5c55.3 0 100.2 45 100.2 100.2s-45 100.2-100.2 100.2S5 160.5 5 105.2 50 5 105.2 5m0-5C47.1 0 0 47.1 0 105.2s47.1 105.2 105.2 105.2 105.2-47.1 105.2-105.2S163.4 0 105.2 0z"/><path d="M97.9 42.2s-23.7 6.7-45 29.3-24 38.7-24 50.7c4.7-8 33.7-52.1 40.5-31.1v50.2s-.4 6.8-10.8 4.1c3.1 5.8 19.1 20.1 48 23 6.6-6.6 15.2-16.1 15.2-16.1l14.4 12.2s25.9-16.8 36.1-41.2c-9.5 6.2-21 20.6-27 10.5V72.7s15.4-23.1 17.8-24.2c-6.1 1.1-27.6 8.2-38.9 22.8-3.2-3.5-12.1-3.6-12.1-3.6s7 5.8 7.1 11.1 0 49.5 0 54.6c-4.8 4.9-9.9 7.5-13.2 7.5-7.7 0-9.9-2.7-12-5.4V71.3s-3.8 3.2-6.8-2S84.1 54 97.9 42.2z"/></svg>
                </div>
                <div class="pl-8">Unreal Engine</div>
            </div>
            </a>
            
            </div>
        </div>
      </div>
      
        

<div class="relative basis-64 shrink-0 hidden lg:block">
  <div class="flex flex-row ml-8 mb-2">
    

<div class="copy-page-menu relative" data-md-url="/docs/md/sdks/analytics.md">
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
            
            <a href="/docs/md/sdks/analytics.md" target="_blank" class="copy-page-link flex items-center w-full px-4 py-2 text-sm text-amp-gray-700 hover:bg-amp-gray-50 hover:text-amp-gray-900 transition-colors duration-150">
                <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View as Markdown
            </a>
            
            <hr class="my-1 border-amp-gray-100">
            
            <a href="https://chat.openai.com/?q=Look+at+this+document+from+Amplitude+so+I+can+ask+questions+about+it%3A+https%3A//amplitude.com/docs/md/sdks/analytics.md" target="_blank" class="open-chatgpt copy-page-link flex items-center w-full px-4 py-2 text-sm text-amp-gray-700 hover:bg-amp-gray-50 hover:text-amp-gray-900 transition-colors duration-150">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-3" viewBox="0 0 320 320">
                    <path d="m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z"/>
                    </svg>
                Open in ChatGPT
            </a>
            
            <a href="https://claude.ai/chat?q=Look+at+this+document+from+Amplitude+so+I+can+ask+questions+about+it%3A+https%3A//amplitude.com/docs/md/sdks/analytics.md" target="_blank" class="open-claude copy-page-link flex items-center w-full px-4 py-2 text-sm text-amp-gray-700 hover:bg-amp-gray-50 hover:text-amp-gray-900 transition-colors duration-150">
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