'use strict';

//const vConsole = new VConsole();
//const remoteConsole = new RemoteConsole("http://[remote server]/logio-post");
//window.datgui = new dat.GUI();

var tracks = [];

var vue_options = {
    el: "#top",
    mixins: [mixins_bootstrap],
    store: vue_store,
    router: vue_router,
    data: {
        clientId: "Test",
        config: {
            channelId: "test",
            clientId: "test",
            signalingUrl: "wss://hogehoge.com/signaling"
        },
        param_start: {
            role: "master",
            localstream: "camera_user"
        },
        has_displaymedia: false,
        remoteClient: {},
        selectingRemoteClient: [],
        remoteClientList: [],
        selectedRemoteClient: null,
        currentRole: null,
    },
    computed: {
    },
    methods: {
        select_remoteClient: async function(){
            this.remoteClient = this.selectedRemoteClient;
            var mediaStream = this.master.getMediaStream(this.remoteClient.clientId);
            if( mediaStream ){
                const video = document.querySelector('#remotecamera_view');
                video.srcObject = mediaStream;
            }
        },
        change_config: function () {
            localStorage.setItem("config", JSON.stringify(this.config));
            this.dialog_close('#config_dialog');
            alert("リロードしてください");
        },
        start: async function () {
            if (this.param_start.role == 'master')
                this.start_master();
            else if (this.param_start.role == 'slave')
                this.start_slave();
            this.currentRole = this.param_start.role;
            this.dialog_close('#start_dialog');
        },
        start_master: async function () {
            if (this.param_start.localstream_type == 'screen') {
                this.localStream = await navigator.mediaDevices.getDisplayMedia({ video: {}, audio: true });
            } else {
                var facingMode = (this.param_start.localstream_type == 'camera_enviroment') ? 'environment' : 'user';
                const constraints = {
                    video: { facingMode: facingMode },
                    audio: { echoCancellation: true, noiseSuppression: true },
                };
                this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            }
            const video = document.querySelector('#localcamera_view');
            video.srcObject = this.localStream;

            var params = {
                localStream: this.localStream,
                channelId: this.config.channelId,
                clientId: this.config.clientId,
                dataLabel: this.config.dataLavel,
                password: this.config.password || "",
                requestOffer: true
            };
            this.master.start(params, (type, result) => {
                console.log(type, result);
                if (type == "peer") {
                    if (result.type == "sdpOffering") {
                        tracks = [];
                    } else
                    if (result.type == "track") {
                        this.remoteClientList = this.master.getRemoteClientList();
                        this.toast_show(result.remoteClientId + 'が接続されました。');
                    }else
                    if( result.type == "connectionstatechange") {
                        this.remoteClientList = this.master.getRemoteClientList();
                        if( result.connectionState == "disconnected")
                            this.toast_show(result.remoteClientId + "との接続が切断されました。");
                    }
                }else if( type == "signaling" ){
                    if( result.type == "closed" ){
                        alert("接続が切断されました。");
                    }else if( result.type == "error"){
                        alert(result.message);
                    }
                }
            });
        },
        connect_slave: async function (remoteClient) {
            this.dialog_close('#connect_dialog');
            this.remoteClient = remoteClient;
            this.slave.connect(remoteClient.clientId, { localStream: this.localStream });
        },
        start_slave: async function () {
            try {
                if (this.param_start.localstream_type == 'screen') {
                    this.localStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
                } else {
                    var facingMode = (this.param_start.localstream_type == 'camera_enviroment') ? 'environment' : 'user';
                    const constraints = {
                        video: { facingMode: facingMode },
                        audio: { echoCancellation: true, noiseSuppression: true },
                    };
                    this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
                }
                const video = document.querySelector('#localcamera_view');
                video.srcObject = this.localStream;

                var params = {
                    channelId: this.config.channelId,
                    clientId: this.config.clientId,
                    password: this.config.password || "" ,
                    dataLabel: this.config.dataLavel,
                };
                this.slave.start(params, (type, result) => {
                    console.log(type, result);
                    if (type == "peer") {
                        if (result.type == "sdpOffering") {
                            tracks = [];
                        } else
                        if (result.type == "track") {
                            if (result.kind == "audio") {
                                tracks.push(result.track);
                                var remoteView = document.querySelector('#remotecamera_view');
                                remoteView.srcObject = new MediaStream(tracks);
                            }else
                            if (result.kind == "video") {
                                tracks.push(result.track);
                                var remoteView = document.querySelector('#remotecamera_view');
                                remoteView.srcObject = new MediaStream(tracks);
                            }
                        }else
                        if( result.type == "connectionstatechange") {
                            if( result.connectionState == "disconnected")
                                this.toast_show("接続が切断されました。");
                        }
                    } else if (type == "signaling") {
                        if (result.type == "ready") {
                            if (result.remoteClientList.length > 0) {
                                if( this.config.clientId == this.remoteClient.clientId){
                                    this.slave.connect(this.remoteClient.clientId, { localStream: this.localStream });
                                }else{
                                    this.selectingRemoteClient = result.remoteClientList;
                                    this.dialog_open("#connect_dialog");
                                }
                            }
                        }else if( type == "signaling" ){
                            if( result.type == "closed" ){
                                alert("接続が切断されました。");
                            }else if( result.type == "error"){
                                alert(result.message);
                            }
                        }
                    }
                });
            } catch (error) {
                console.error(error);
                alert(error);
            }
        },
        onResize: function () {
            this.$nextTick(() => {
                var video = document.querySelector('#remotecamera_view');
                var width = document.querySelector('#div_remotecamera_view').clientWidth;
                video.width = width;
                var video = document.querySelector('#localcamera_view');
                var width = document.querySelector('#div_localcamera_view').clientWidth;
                video.width = width;
            });
        },
    },
    created: function () {
    },
    mounted: function () {
        proc_load();

        if (navigator.mediaDevices.getDisplayMedia)
            this.has_displaymedia = true;

        var config = localStorage.getItem("config");
        if (config) {
            this.config = JSON.parse(config);
        }else{
            this.config.signalingUrl = "wss://" + location.host + "/sigannling";
        }
        this.slave = new WebrtcSlave(this.config.signalingUrl, this.config.apiKey);
        this.master = new WebrtcMaster(this.config.signalingUrl, this.config.apiKey);

        this.onResize();
        window.addEventListener('resize', this.onResize);
    }
};
vue_add_data(vue_options, { progress_title: '' }); // for progress-dialog
vue_add_global_components(components_bootstrap);
vue_add_global_components(components_utils);

/* add additional components */

window.vue = new Vue(vue_options);
