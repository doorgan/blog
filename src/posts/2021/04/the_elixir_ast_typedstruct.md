---
title: "A deep dive into the Elixir AST: Building a typed struct macro"
date: "2021-04-16"
image: "/assets/img/posts/a_deep_dive_into_the_elixir_ast_cover.png"
tags:
  - elixir
  - ast
  - macros
---

Part 2 of The Elixir AST series. Analyzing the AST to build a typed struct macro.

<!-- excerpt -->

{% cover_img "a_deep_dive_into_the_elixir_ast_cover.png" "iex> quote do: sum(1, 2, 3); {:sum, [], [1, 2, 3]" %}

---

This article was split into three parts:

- [Part one: The Elixir AST](/posts/2021/04/the_elixir_ast/)
- [Part two: The Elixir AST: Building a typed struct macro](/posts/2021/04/the_elixir_ast_typedstruct/)
- [Part three: The Elixir AST: Building a static code analyzer](/posts/2021/04/the_elixir_ast_analyzer/)

---

This is the second part of The Elixir AST series. In the previous chapter we looked into the AST and learned what kind of shapes it can take, in this chapter we will leverage that knowledge to build a typed struct macro.

Now that we know what the AST looks like, we can use it to build something useful. Let's look at the following piece of code:

```elixir
defmodule Report do
  @type report_type :: :refactoring | :warning | :consistency

  @type t :: %__MODULE__{
    type: report_type,
    description: String.t,
    message: String.t | nil
  }
  @enforce_keys [:type, :description]
  defstruct [:description, :message, type: :refactoring]
end
```

This is fairly standard Elixir code for defining a struct, enforcing some of its keys, and defining an accompanying typespec. It is, however, quite verbose and hard to follow, since we have to make some jumps between the type, the defstruct and the enforce_keys attribute to check what it looks like and if everything is alright.
We can use a macro so simplify it a bit, and make the syntax closer to that of Ecto schemas. The macro we'll be writing will allow us to write the above code like this:

```elixir
defmodule Report do
  @type report_type :: :refactoring | :warning | :consistency

  typedstruct do
    field :type, report_type, required?: true, default: :refactoring
    field :description, String.t, required?: true
    field :message, String.t
  end
end
```

The plan is the following: we will define a `typedstruct` macro, and extract the struct data from the received AST to finally generate the struct definition, typespec, and enforcing options. There are other ways to achieve this, but they involve the definition of more macros and, while they can improve error reporting and are generally more easily extensible, they are too complex for the purposes of this exercise.

Let's start by creating the macro:

```elixir
defmodule TypedStruct do
  defmacro typedstruct(ast) do
    # ...
  end
end
```

The intended usage of the macro is with a `do` block. This syntax is sugar for the case when the last element for a function is a keyword list, and its last element has the `:do` key.
If we look at this example:

```elixir
typedstruct do
  field :message, String.t
end
```

The argument passed to `typedstruct` will be `[do: ...]`. What comes after the `do` can be a single expression if it's just one line, or a `:__block__` call if it's two or more, as we saw earlier. We'll need to consider this when we extract the fields from the AST.
A simple way to do it is to ensure we always have a list of lines:

```elixir
# The macro will always be used with a do block, so we match against that
defmacro typedstruct(do: ast) do
  fields_ast =
    case ast do
      {:__block__, [], fields} -> fields
      field -> [field]
    end
end
```

Now we need to look at the received AST and look for `:field` calls. Each line should be a field definition like this one:

```elixir
field :description, String.t, enforced?: true
```

As we saw earlier, this would be represented by a call like this:

```elixir
{:field, [], [field_name, typespec, options?]}
```

Since we have a list of the fields AST, we can create a helper function to extract the data we need from them and use `Enum.map` to get a list of fields data back:

```elixir
defmacro typedstruct(do: ast) do
  fields_ast =
    case ast do
      {:__block__, [], fields} -> fields
      field -> [field]
    end

  fields_data = Enum.map(fields_ast, &get_field_data/1)
end

defp get_field_data({:field, [], [name, typespec]}) do
  # In this case the options were not provided,
  # so we set them to the empty list and process
  # it again
  get_field_data({:field, [], [name, typespec, []]})
end
defp get_field_data({:field, [], [name, typespec, opts]}) do
  default = Keyword.get(opts, :default)
  enforced? = Keyword.get(opts, :enforced?, false)

  %{
    name: name,
    typespec: typespec,
    default: default,
    enforced?: enforced?
  }
end
```

Great! Now the next step is to use this data to build the code we wanted to abstract. For this we will use `quote` to create a quoted expression, and `unquote`/`unquote_splicing` to interpolate the data we just obtained.

For the enforced fields list, this one is easy, we just need the names of the fields where `enforced?` is true:

```elixir
enforced_fields =
  for field <- fields_data, field.enforced? do
    field.name
  end
```

The typespec for a struct would look like this:

```
@type t :: %__MODULE__{
  name: typespec
}
```

If we recall from the AST node types section, the arguments for a map constructor call is a keyword list, just like when we try to enumerate a map with the `Enum` module. If we want to insert our typespecs there, we need to create keyword list entries(`{name, value}` tuples):

```elixir
typespecs =
  Enum.map(fields_data, fn
    %{name: name, typespec: typespec} -> {name, typespec}
  end)
```

There is a catch, though. If the field is not enforced, then the typespec would also need to reflect this with `typespec | nil`, so we need to add an extra clause to our function:

```elixir
typespecs =
  Enum.map(fields_data, fn
    %{name: name, typespec: typespec, enforced?: true} -> {name, typespec}
    %{name: name, typespec: typespec} ->
      {
        name,
        {:|, [], [typespec, nil]}
      }
  end)
```

Here I'm doing the same as in the previous case if the field is enforce, otherwise I build a call to the `|` operator to create the `typespec | nil` syntax.

Finally, for the list of fields and their defaults:

```elixir
fields =
  for %{name: name, default: default} <- fields_data do
    {name, default}
  end
```

Now that we have everything we need, we can generate the code:

```elixir
quote location: :keep do
  @type t :: %__MODULE__{unquote_splicing(typespecs)}
  @enforce_keys unquote(enforced_fields)
  defstruct unquote(fields)
end
```

The `location: :keep` option will add a `keep: {source, line}` field to the nodes metadata. This AST will be inserted in the place the macro was called. If any error happens, the error message will have the line numbers of the _expanded_ code, which makes it difficult to find where exactly the error happened as those numbers don't always correspond to the ones in the original source code. The `:keep` data is used to solve this problem.

And that's it! We now have a macro to easily define typespec-ed structs.

The final code:

```elixir
defmodule TypedStruct do
  defmacro typedstruct(do: ast) do
    fields_ast =
      case ast do
        {:__block__, [], fields} -> fields
        field -> [field]
      end

    fields_data = Enum.map(fields_ast, &get_field_data/1)

    enforced_fields =
      for field <- fields_data, field.enforced? do
        field.name
      end

    typespecs =
      Enum.map(fields_data, fn
        %{name: name, typespec: typespec, enforced?: true} -> {name, typespec}
        %{name: name, typespec: typespec} ->
          {
            name,
            {:|, [], [typespec, nil]}
          }
      end)

    fields =
      for %{name: name, default: default} <- fields_data do
        {name, default}
      end

    quote location: :keep do
      @type t :: %__MODULE__{unquote_splicing(typespecs)}
      @enforce_keys unquote(enforced_fields)
      defstruct unquote(fields)
    end
  end

  defp get_field_data({:field, [], [name, typespec]}) do
    get_field_data({:field, [], [name, typespec, []]})
  end
  defp get_field_data({:field, [], [name, typespec, opts]}) do
    default = Keyword.get(opts, :default)
    enforced? = Keyword.get(opts, :enforced?, false)

    %{
      name: name,
      typespec: typespec,
      default: default,
      enforced?: enforced?
    }
  end
end
```

You can now try it yourself. Define a struct using this macro, and then try to create a struct with a missing enforced field, or using `t MyStruct.t` in IEx to check that the generated typespec is correct.

---

In the next article, we will use the AST to build another fun project: out own little version of [credo](https://github.com/rrrene/credo)!

- [Part one: The Elixir AST](/posts/2021/04/the_elixir_ast/)
- [Part three: The Elixir AST: Building a static code analyzer](/posts/2021/04/the_elixir_ast_analyzer/)
