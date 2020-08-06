<svelte:options tag="my-element"/>
<style>
h1 {
color: pink;
}
</style>
<script>
    let name = 'world';
    setInterval(() => {
      name = name + '.';   
    }, 1000);
</script>

<h1>Hello {name}!</h1>
