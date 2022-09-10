import {
    Scene,
    WebGLRenderer,
    PerspectiveCamera,
    MeshLambertMaterial,
    Mesh,
    PointLight,
    BufferAttribute,
    Vector2,
    Raycaster,
    SphereGeometry,
} from 'three';
import { map, range } from 'lodash';
import { Lut } from 'three/examples/jsm/math/Lut.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'dat.gui';

// Create global scene
const scene = new Scene();

// Create loader for PLY files
const loader = new PLYLoader();

// Setup raycaster
const raycaster = new Raycaster();

// Track mouse
var pointer = new Vector2();
function onMouseMove(event) {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
}
window.addEventListener('mousemove', onMouseMove, false);

// Create color lookup table
const lut = new Lut("cooltowarm", 1024);
lut.setMax(2);
lut.setMin(-2);

// Create global object for time series data
const time_series = {
    "left": null,
    "right": null,
    "left_dconn": null,
    "right_dconn": null,
}
const active_data = {
    "left": null,
    "right": null,
}

// Track the vertex index the mouse is hover over
var active_vertex_index = null;
var active_mesh = null;
var active_point = null;
var active_sphere = null;

// Set global lock
var lock = false;

// Correlation function
function correlation(x, y) 
{ 
    let length = x.length;
	let xy = map(x, (v, i) => { return v * y[i]; });
	let x2 = map(x, (v) => { return v * v; });
	let y2 = map(y, (v) => { return v * v; });
 
	let sum_x = x.reduce((a, b) => a + b, 0);
	let sum_y = y.reduce((a, b) => a + b, 0);
	let sum_xy = xy.reduce((a, b) => a + b, 0);
	let sum_x2 = x2.reduce((a, b) => a + b, 0);
	let sum_y2 = y2.reduce((a, b) => a + b, 0);
 
	let step1 = (length * sum_xy) - (sum_x * sum_y);
	let step2 = (length * sum_x2) - (sum_x * sum_x);
	let step3 = (length * sum_y2) - (sum_y * sum_y);
	let step4 = Math.sqrt(step2 * step3);
	let result = step1 / step4;
    return result == NaN ? 0 : result;
}

// Load meshes
function load_meshes() {
    // Callback function for adding mesh via loader
    function add_mesh(geometry, name) {
        geometry.rotateX(-Math.PI / 2);
        geometry.rotateY(Math.PI / 2);
        let blank_array = new Float32Array(32492 * 3);
        blank_array.fill(1);
        geometry.setAttribute('color', new BufferAttribute(blank_array, 3));
        geometry.computeVertexNormals();
        const material = new MeshLambertMaterial({
            color: 0xF5F5F5,
            "vertexColors": true
        });
        const mesh = new Mesh(geometry, material);
        mesh.name = name;
        scene.add(mesh);
    }
    loader.load("Data/MSC01/left_pial.ply", (g) => { add_mesh(g, "left_pial"); });
    loader.load("Data/MSC01/right_pial.ply", (g) => { add_mesh(g, "right_pial"); });
    loader.load("Data/MSC01/left_midthickness.ply", (g) => { add_mesh(g, "left_midthickness"); });
    loader.load("Data/MSC01/right_midthickness.ply", (g) => { add_mesh(g, "right_midthickness"); });
    loader.load("Data/MSC01/left_inflated.ply", (g) => { add_mesh(g, "left_inflated"); });
    loader.load("Data/MSC01/right_inflated.ply", (g) => { add_mesh(g, "right_inflated"); });
    loader.load("Data/MSC01/left_very_inflated.ply", (g) => { add_mesh(g, "left_veryinflated"); });
    loader.load("Data/MSC01/right_very_inflated.ply", (g) => { add_mesh(g, "right_veryinflated"); });
}

// Setup the lighting of the scene
function setup_lighting() {
    var light = new PointLight(0xffffff, 1, 800);
    light.position.set(0, 300, 0);
    scene.add(light);
    var light = new PointLight(0xffffff, 1, 800);
    light.position.set(300, 0, 0);
    scene.add(light);
    var light = new PointLight(0xffffff, 1, 800);
    light.position.set(0, 0, 300);
    scene.add(light);
    var light = new PointLight(0xffffff, 1, 800);
    light.position.set(0, -300, 0);
    scene.add(light);
    var light = new PointLight(0xffffff, 1, 800);
    light.position.set(-300, 0, 0);
    scene.add(light);
    var light = new PointLight(0xffffff, 1, 800);
    light.position.set(0, 0, -300);
    scene.add(light);
}

// Set visibility of meshes
function set_visibility(scene, active_surface) {
    scene.traverse(function (child) {
        if (child instanceof Mesh) {
            if (child.name.includes(active_surface) || child.name.includes("active_sphere")) {
                child.visible = true;
            } else {
                child.visible = false;
            }
        }
    });
}

// Set colors of meshes
function set_colors(scene) {
    scene.traverse(function (child) {
        if (child instanceof Mesh && !child.name.includes("active_sphere")) {
            if (active_data["left"] == null || active_data["right"] == null) {
                let blank_array = new Float32Array(32492 * 3);
                blank_array.fill(1);
                child.geometry.setAttribute('color', new BufferAttribute(blank_array, 3));
                child.geometry.getAttribute('color').needsUpdate = true;
            }
            else {
                let color_array = convert_to_color(active_data[child.name.includes("left") ? "left" : "right"]);
                for (let i = 0; i < 32492; i++) {
                    
                    let color = color_array[i];
                    if (color == undefined) {
                        color = { r: 1, g: 1, b: 1 };
                    }
                    child.geometry.getAttribute('color').setXYZ(i, color.r, color.g, color.b);
                }
                child.geometry.getAttribute('color').needsUpdate = true;
            }
        }
    });
}

// Get time series data
function get_data(path, side) {
    const req = new XMLHttpRequest();
    req.responseType = "arraybuffer";
    req.open('GET', path, true);
    req.onload = (event) => {
        const arrayBuffer = req.response;
        time_series[side] = new Float32Array(arrayBuffer);
    }
    req.send(null);
}

// Convert from float to color
function convert_to_color(array) {
    return map(array, (v) => { return lut.getColor(v); });
}

// Function to access array convieniently
function get_time(array, n) {
    return array.slice(n * 32492, (n + 1) * 32492);
}

function get_seed(array, n) {
    return array.slice(n * 818, (n + 1) * 818);
}

// Get value data at time t (linear interpolation)
function get_time_at_t(array, t) {
    if (t < 1799600) {
        let t1 = Math.floor(t / 2200);
        let t2 = t1 + 1;
        let v1 = get_time(array, t1);
        let v2 = get_time(array, t2);
        let v = map(v1, (v, i) => { return v + (v2[i] - v) * (t % 2200) / 2200; });
        return v;
    }
}

// Compute Seed
function compute_seed() {
    if (active_vertex_index != null && active_mesh != null) {
        let surface;
        // get the selected mesh
        if (active_mesh == "left") {
            surface = time_series["left_dconn"]
        }
        else {
            surface = time_series["right_dconn"]
        }
        
        // get seed closest to active vertex
        let seed = get_seed(surface, active_vertex_index);

        // compute correlations
        let left_corr = map(range(32492), (i) => { 
            return correlation(seed, get_seed(time_series["left_dconn"], i)); });
        let right_corr = map(range(32492), (i) => { 
            return correlation(seed, get_seed(time_series["right_dconn"], i)); });
        
        // compute colors and set active data
        active_data["left"] = left_corr;
        active_data["right"] = right_corr;
    }
    document.getElementById("info").innerHTML = `Seed ${active_vertex_index} on ${active_mesh} hemisphere selected.`;
    lock = false;
}

// Render the scene
function render() {
    // Setup renderer
    const renderer = new WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // Setup camera
    const camera = new PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 250;
    camera.zoom = 1;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableKeys = false;

    // Resize handler
    window.addEventListener('resize', function () {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Setup gui
    const gui = new GUI({ 'width': 500 });
    const active_surface = { "surface": "_pial" }
    const active_mode = { "mode": "time" }
    const sim = { t: 0, stop: false };
    const color = { map: "cooltowarm" }

    const folder = gui.addFolder('Parameters');
    folder.add(color, 'map', [ 'rainbow', 'cooltowarm', 'blackbody', 'grayscale' ]).onChange(function (){
        lut.setColorMap(color.map);
    });
    folder.add(active_surface, "surface",
        {
            "Pial": "_pial",
            "Midthickness": "_midthickness",
            "Inflated": "_inflated",
            "Very Inflated": "_veryinflated"
        });
    folder.add(active_mode, "mode",
        {
            "Time": "time",
            "Seed": "seed",
        }).onChange(function () { 
            active_data["left"] = null;
            active_data["right"] = null;
            if (active_mode.mode === "time") {
                document.getElementById("info").innerHTML = "Brain Demo";
                lut.setMax(2);
                lut.setMin(-2);
            }
            else {
                lut.setMax(1);
                lut.setMin(-1);
            }
        });
    folder.add(lut, "maxV", 0, 10).listen();
    folder.add(lut, "minV", -10, 0).listen();
    folder.add(sim, 't', 0, 1799600).step(1000).listen();
    folder.add({ "Start/Stop": function () { sim.stop = !sim.stop; } }, "Start/Stop");
    folder.add({ "Reset Time": function () { sim.t = 0; } }, "Reset Time");
    folder.open();
    gui.close();

    // load meshes
    load_meshes();

    // get time series data
    get_data("Data/MSC01/left.dtseries", "left");
    get_data("Data/MSC01/right.dtseries", "right");

    // get transposed time series data for seed mode
    get_data("Data/MSC01/left.dconn", "left_dconn");
    get_data("Data/MSC01/right.dconn", "right_dconn");

    // Setup lighting
    setup_lighting();

    // add handler on mouse click
    window.addEventListener('click', async function (event) {
        if (!event.ctrlKey) {
            return;
        }
        if (!lock && active_mode.mode === "seed") {
            lock = true;
        }
        else {
            return;
        }
        document.getElementById("info").innerHTML = "Computing Seed Please Wait...";
        // delete any existing sphere
        if (active_sphere != null) {
            scene.remove(active_sphere);
        }
        // create a new sphere
        let active_sphere_geo = new SphereGeometry(1, 32, 16);
        active_sphere_geo.translate(active_point.x, active_point.y, active_point.z);
        active_sphere = new Mesh(active_sphere_geo, new MeshLambertMaterial({ color: 0xffffff }));
        active_sphere.name = "active_sphere";
        scene.add(active_sphere);

        setTimeout(compute_seed, 100);
    });

    // Get current time
    let current_time = (new Date()).getTime();

    // Render loop
    function animate() {
        if (active_mode.mode === "time") {
            if (active_sphere != null) {
                scene.remove(active_sphere);
                active_sphere = null;
            }
            if ((new Date()).getTime() - current_time > 100) {
                current_time = (new Date()).getTime();
                if (time_series["left"] != null && time_series["right"] != null) {
                    active_data["left"] = get_time_at_t(time_series["left"], sim.t);
                    active_data["right"] = get_time_at_t(time_series["right"], sim.t);
                }
                if (active_data["left"] != null && active_data["right"] != null) {
                    set_colors(scene);
                }
                if (!sim.stop) {
                    sim.t += 100;
                }
                if (sim.t > 1799600) {
                    sim.t = 1799600;
                }
            }
        }
        else {
            if (!lock) {
                // update the picking ray with the camera and pointer position
                raycaster.setFromCamera(pointer, camera);

                // calculate objects intersecting the picking ray
                const intersects = raycaster.intersectObjects(scene.children);
                if (intersects.length > 0 && time_series["left_dconn"] != null && time_series["right_dconn"] != null) {
                    // get the intersect with the active surface
                    let intersect_object = null;
                    for (let i = 0; i < intersects.length; i++) {
                        if (intersects[i].object.name.includes(active_surface.surface)) {
                            intersect_object = intersects[i];
                            break;
                        }
                    }
                    if (intersect_object != null) {
                        active_vertex_index = intersect_object.face.a;
                        active_mesh = intersect_object.object.name.includes("left") ? "left" : "right";
                        active_point = intersect_object.point;
                    }
                };
                set_colors(scene);
            }
        }
        set_visibility(scene, active_surface.surface);
        requestAnimationFrame(animate);
        controls.update();
        camera.updateProjectionMatrix();
        renderer.render(scene, camera);
    }
    animate();
}
render();
